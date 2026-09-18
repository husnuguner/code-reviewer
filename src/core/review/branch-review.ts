/**
 * Branch-vs-base review: read local git, review, report.
 *
 * The only review flow there is. The source is a working tree compared
 * against a base ref; the sink is a reporter (text, NDJSON or GitHub
 * workflow commands). Nothing is created anywhere and no credential beyond
 * the model's is needed -- which is why this works against a repository whose
 * hosting system nobody has implemented, against work that has not been
 * pushed, and inside CI with no write permission at all.
 *
 * Reporting is where this flow stops. Turning a finding into a comment on a
 * pull request is somebody else's job (a CI bot reading the NDJSON), and the
 * separation is deliberate: a reviewer that cannot write to a conversation
 * cannot spam one, and the same run behaves identically on a laptop and in a
 * pipeline.
 */

import pLimit from "p-limit";

import { type ChangedFileEntry } from "../domain/changed-file";
import { type CodeContext } from "../ports/code-context";
import { type GitReader } from "../ports/git-reader";
import { type Logger, NULL_LOGGER } from "../ports/logger";
import {
  type BranchReviewRecord,
  type BranchReviewReporter,
  type FindingRecord,
  type SummaryRecord,
} from "../ports/review-reporter";
import { type SkillMatcher } from "../ports/skill-matcher";
import { asCompleted } from "../util/as-completed";
import { errorMessage } from "../util/errors";
import { compareCodePoints } from "../util/text";

import { previewReport, textBody } from "./render";
import {
  type FileReviewSettings,
  type PerFileReviewer,
  type PerFileVerifier,
  type ReviewedFile,
  countAnchors,
  reviewChangedFile,
} from "./review-file";
import {
  type FileDecision,
  type SelectedFile,
  logSkips,
  selectFiles,
  selectedFiles,
  skipCounts,
} from "./selection";
import { capPerFile } from "./volume";

export interface BranchReviewOptions {
  readonly base: string;
  readonly branch: string;
  readonly reviewer: PerFileReviewer;
  /** Checks each file's findings against its diff; `null` reports them all. */
  readonly verifier?: PerFileVerifier | null;
  readonly git: GitReader;
  readonly settings: FileReviewSettings;
  readonly skills: SkillMatcher | null;
  /** Global cap on simultaneous file reviews (content read + model call). */
  readonly maxConcurrentFiles: number;
  /**
   * Max findings reported per file; the most severe survive, the rest are
   * counted into the summary's `capped`. `0` (the default) reports them all.
   */
  readonly maxFindingsPerFile?: number;
  /** Reads the repository beyond the diff, at `branch`; `null` gathers no pre-context. */
  readonly codeContext?: CodeContext | null;
  readonly logger?: Logger;
}

/**
 * Stream review records for the diff between `base` and `branch`.
 *
 * The changed-file set is a three-dot diff, so only what this branch itself
 * changed is reviewed -- not commits `base` gained after the fork.
 *
 * Yields one `finding` record per finding **as each file's review completes**,
 * then a single `summary` record.
 */
export async function* iterBranchReview(
  options: BranchReviewOptions,
): AsyncGenerator<BranchReviewRecord> {
  const { base, branch, git } = options;
  const log = (options.logger ?? NULL_LOGGER).child("review.branch_review");

  const files = await changedFilesOf(options, log);
  // Scope first, and once: the same decisions `--preview` would have printed.
  const decisions = selectFiles(files, options.settings);
  const selected = selectedFiles(decisions);
  logSkips(decisions, options.logger);

  const limit = pLimit(options.maxConcurrentFiles);
  // Built from the *selected* files: pre-context quotes other files' diffs,
  // so an excluded -- or a credential -- file must not be reachable as
  // somebody else's "related change".
  const changeSet = selected.map((decision) => decision.file);
  const reviewOne = async (decision: SelectedFile): Promise<ReviewedFile | null> =>
    reviewChangedFile(decision, {
      reviewer: options.reviewer,
      verifier: options.verifier ?? null,
      settings: options.settings,
      skills: options.skills,
      limit,
      readContent: (path) => git.readFile(path, options.settings.maxFileChars),
      codeContext: options.codeContext ?? null,
      changeSet,
      ...(options.logger && { logger: options.logger }),
    });

  let filesReviewed = 0;
  let totalFindings = 0;
  let unanchored = 0;
  let refuted = 0;
  let capped = 0;
  let mislabelled = 0;
  // A file selected for review that produced neither findings nor a refusal:
  // its review threw. Counted rather than merely logged, so the summary's
  // arithmetic still adds up (see `SummaryRecord.failed`).
  let failed = 0;
  // A credential the per-file step refused although the selection had passed
  // it (only reachable for a hand-built decision). It is the same refusal
  // `selection.ts` makes, so it is counted with those rather than invented as
  // a reason of its own.
  let guarded = 0;
  const anchors = new Map<string, number>();
  const filesWithFindings = new Set<string>();

  // Completion order lets each file's findings emit the moment it finishes
  // rather than waiting for the whole batch; the limit still bounds how many
  // run at once, and every promise is held so a failure cannot go unobserved.
  const outcomes = asCompleted(selected.map((decision) => reviewOne(decision)));
  for await (const outcome of outcomes) {
    if (!outcome.ok) {
      const detail = errorMessage(outcome.error);
      failed++;
      log.warn(`Reviewing a file on '${branch}' failed: ${detail}`);
      continue;
    }
    const result = outcome.value;
    if (result === null) {
      guarded++;
      continue;
    }
    filesReviewed++;
    refuted += result.refuted;
    const volume = capPerFile(result.findings, options.maxFindingsPerFile ?? 0);
    capped += volume.capped;
    // Every per-finding tally is taken over the findings that are actually
    // reported, so `anchors`, `unanchored`, `mislabelled` and `findings`
    // describe one population and can be checked against each other. What
    // the cap withheld is not silent for it: `capped` says how many, and a
    // number that mixed two populations would make both unreadable.
    for (const [name, n] of countAnchors(volume.kept)) {
      anchors.set(name, (anchors.get(name) ?? 0) + n);
    }
    mislabelled += volume.kept.filter((finding) => finding.severity_claimed !== "").length;
    if (volume.capped > 0) {
      log.info(
        `${result.path}: ${volume.capped} finding(s) withheld by max-findings-per-file=${options.maxFindingsPerFile ?? 0}.`,
      );
    }
    for (const finding of volume.kept) {
      totalFindings++;
      if (finding.line === null) unanchored++;
      filesWithFindings.add(result.path);
      yield {
        type: "finding",
        path: result.path,
        line: finding.line,
        start_line: finding.start_line,
        anchor: finding.anchor,
        severity: finding.severity,
        body: finding.body,
        example: finding.example,
        skills: result.skillNames,
      };
    }
  }

  yield {
    type: "summary",
    base,
    branch,
    files_changed: files.length,
    files_reviewed: filesReviewed,
    // A file whose review threw, and how many diffs were shown in part only.
    // Both are knowledge the run has and the findings cannot carry.
    failed,
    truncated: selected.filter((decision) => decision.truncated).length,
    findings: totalFindings,
    files_with_findings: filesWithFindings.size,
    // How each finding's line was decided, and how many got none at all.
    // Without these the anchoring is invisible: a repaired line looks exactly
    // like one the model got right.
    anchors: Object.fromEntries([...anchors].toSorted(([a], [b]) => compareCodePoints(a, b))),
    unanchored,
    // How many findings the verification pass removed before they were ever
    // reported. Zero also means "no verification ran"; the two are the same
    // thing to a consumer, which is told what it was told either way.
    refuted,
    // How many the volume policy withheld. Reported for the same reason as
    // `refuted`: a finding that vanishes without a number behind it is a
    // finding nobody can ask about.
    capped,
    // How many reported findings arrived under a severity the vocabulary has
    // not got, and were reported under the mildest one instead.
    mislabelled,
    // What happened to the files that were not reviewed, by reason. Without
    // it `files_changed` minus `files_reviewed` is a number nobody can act
    // on; with it, a rule that quietly ate half the change set is visible.
    skipped: Object.fromEntries(
      [...withGuarded(skipCounts(decisions), guarded)].toSorted(([a], [b]) =>
        compareCodePoints(a, b),
      ),
    ),
  };
}

/**
 * The skip counts with the per-file step's own credential refusals folded in.
 *
 * Two guards answer the same question (`guards.ts` is asked by the selection
 * and again where the prompt is built), so they report as one reason: a
 * withheld credential is a withheld credential whichever of them caught it.
 */
function withGuarded(
  counts: ReadonlyMap<string, number>,
  guarded: number,
): ReadonlyMap<string, number> {
  if (guarded === 0) return counts;
  const merged = new Map(counts);
  merged.set("secret", (merged.get("secret") ?? 0) + guarded);
  return merged;
}

/**
 * The changed files of `branch` against `base`, as the three-dot diff sees
 * them. Shared by the review and the preview, so the two cannot disagree
 * about which base they compared against.
 */
async function changedFilesOf(
  options: Pick<BranchReviewOptions, "base" | "branch" | "git">,
  log: Logger,
): Promise<ChangedFileEntry[]> {
  const { base, branch, git } = options;
  const forkPoint = await git.mergeBase(base, branch);
  if (forkPoint === null) {
    log.warn(`No merge-base for '${branch}' and '${base}'; comparing against '${base}' directly.`);
  }
  const files = await git.changedFiles(forkPoint ?? base, branch);
  log.info(`Branch '${branch}' vs '${base}' in ${git.root}: ${files.length} changed file(s).`);
  return files;
}

/** What a branch preview needs: local git and the settings, nothing else. */
export interface BranchPreviewOptions {
  readonly base: string;
  readonly branch: string;
  readonly git: GitReader;
  readonly settings: FileReviewSettings;
  readonly logger?: Logger;
}

/**
 * What a branch review would review, without calling a model.
 *
 * The cheapest honest answer this tool can give: local git, the project's
 * own exclusions, and no credentials of any kind -- not even a model key.
 * Returns the decisions and the report text, so a caller can print it or
 * inspect it.
 */
export async function previewBranch(
  options: BranchPreviewOptions,
): Promise<{ decisions: FileDecision[]; report: string }> {
  const log = (options.logger ?? NULL_LOGGER).child("review.branch_review");
  const files = await changedFilesOf(options, log);
  const decisions = selectFiles(files, options.settings);
  return {
    decisions,
    report: previewReport(
      `branch ${options.branch} vs ${options.base}`,
      decisions,
      options.settings.maxFileChars,
    ),
  };
}

/** A branch review collected into one result (for text output and tests). */
export interface BranchReviewResult {
  readonly findings: readonly Omit<FindingRecord, "type">[];
  readonly files_changed: number;
  readonly files_reviewed: number;
  /** Files selected for review whose review did not finish. */
  readonly failed: number;
  /** Files whose diff was shown in part only (`max-file-chars`). */
  readonly truncated: number;
  readonly anchors: Readonly<Record<string, number>>;
  readonly unanchored: number;
  readonly refuted: number;
  /** Findings `max-findings-per-file` withheld. */
  readonly capped: number;
  /** Reported findings whose severity the model spelled outside the vocabulary. */
  readonly mislabelled: number;
  /** How many files each skip reason accounted for. */
  readonly skipped: Readonly<Record<string, number>>;
}

/** Run `iterBranchReview` to completion and collect it into a result. */
export async function reviewBranch(options: BranchReviewOptions): Promise<BranchReviewResult> {
  const findings: Omit<FindingRecord, "type">[] = [];
  let summary: SummaryRecord | null = null;
  for await (const record of iterBranchReview(options)) {
    if (record.type === "finding") {
      const { type: _type, ...rest } = record;
      findings.push(rest);
    } else {
      summary = record;
    }
  }
  return collect(findings, summary);
}

/** The findings and the closing record as one result; the summary may be absent. */
function collect(
  findings: readonly Omit<FindingRecord, "type">[],
  summary: SummaryRecord | null,
): BranchReviewResult {
  return {
    findings,
    files_changed: summary?.files_changed ?? 0,
    files_reviewed: summary?.files_reviewed ?? 0,
    failed: summary?.failed ?? 0,
    truncated: summary?.truncated ?? 0,
    anchors: summary?.anchors ?? {},
    unanchored: summary?.unanchored ?? 0,
    refuted: summary?.refuted ?? 0,
    capped: summary?.capped ?? 0,
    mislabelled: summary?.mislabelled ?? 0,
    skipped: summary?.skipped ?? {},
  };
}

/**
 * Feed every record of a branch review to a reporter as it is produced, and
 * return the same result `reviewBranch` would have collected.
 *
 * Streaming and summarising are not alternatives: the reporter gets each
 * record the moment it exists, and the caller still gets the whole run back
 * so it can answer questions about it (`--fail-on`) without re-reading its
 * own output.
 */
export async function streamBranchReview(
  options: BranchReviewOptions,
  reporter: BranchReviewReporter,
): Promise<BranchReviewResult> {
  const findings: Omit<FindingRecord, "type">[] = [];
  let summary: SummaryRecord | null = null;
  for await (const record of iterBranchReview(options)) {
    reporter.report(record);
    if (record.type === "finding") {
      const { type: _type, ...rest } = record;
      findings.push(rest);
    } else {
      summary = record;
    }
  }
  return collect(findings, summary);
}

/** A finding as the text report needs it; every tally may be absent. */
export interface TextReportInput {
  readonly findings: readonly Omit<FindingRecord, "type">[];
  readonly anchors?: Readonly<Record<string, number>>;
  /** Files selected for review whose review did not finish. */
  readonly failed?: number;
  /** Files whose diff was shown in part only (`max-file-chars`). */
  readonly truncated?: number;
}

/**
 * What a reader must know before believing the findings above.
 *
 * Printed in both branches, and that is the point of it being its own
 * function: "No issues found." is a claim about the code, and on a run where
 * two files never came back it is the wrong one. A silence has to say which
 * kind of silence it is.
 */
function caveats(result: TextReportInput): string[] {
  const notes: string[] = [];
  const failed = result.failed ?? 0;
  const truncated = result.truncated ?? 0;
  if (failed > 0) {
    notes.push(`${failed} file(s) could not be reviewed; the log says why.`);
  }
  if (truncated > 0) {
    notes.push(
      `${truncated} file(s) had a diff too large to show in full; only what was shown was reviewed.`,
    );
  }
  return notes;
}

/** The human-readable report, as lines to print (interactive use). */
export function branchReviewText(base: string, branch: string, result: TextReportInput): string[] {
  const lines = [`\n=== Branch review: ${branch} vs ${base} ===`];
  const { findings } = result;
  if (findings.length === 0) {
    lines.push("No issues found.", ...caveats(result));
    return lines;
  }
  const files = new Set(findings.map((f) => f.path)).size;
  lines.push(`${findings.length} finding(s) across ${files} file(s).`);
  // Only worth a line when something other than a clean hit happened.
  const notable = Object.entries(result.anchors ?? {})
    .filter(([name, n]) => name !== "exact" && n > 0)
    .toSorted(([a], [b]) => compareCodePoints(a, b));
  if (notable.length > 0) {
    lines.push(`anchors: ${notable.map(([name, n]) => `${n} ${name}`).join(", ")}`);
  }
  lines.push(...caveats(result), "");
  // An unanchored finding sorts first: it has no line, and -1 keeps the key
  // comparable.
  const ordered = findings.toSorted(
    (a, b) => compareCodePoints(a.path, b.path) || (a.line ?? -1) - (b.line ?? -1),
  );
  for (const f of ordered) {
    const where = f.line === null ? `${f.path}  (no line anchor)` : `${f.path}:${f.line}`;
    lines.push(where);
    for (const line of textBody(f.severity, f.body).split("\n")) lines.push(`  ${line}`);
    if (f.example) {
      lines.push("  ```");
      for (const line of f.example.split("\n")) lines.push(`  ${line}`);
      lines.push("  ```");
    }
    if (f.skills.length > 0) lines.push(`  (skills: ${f.skills.join(", ")})`);
    lines.push("");
  }
  return lines;
}
