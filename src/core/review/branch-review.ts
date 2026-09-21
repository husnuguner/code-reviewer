/**
 * The review flow: read local git, select, review in parallel, cap, stream records. Reporting is where
 * it stops; posting is another run's job.
 *
 * The reviewed side is always the checkout: `HEAD` against a base, or the working tree against `HEAD`.
 * There is no reviewing a ref without checking it out, so the diff, the file contents and the
 * pre-context are one tree.
 * @packageDocumentation
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

/** Options for {@link iterBranchReview} and its wrappers. */
export interface BranchReviewOptions {
  /** What the checkout is compared against. */
  readonly base: string;
  /** Review the working tree against `HEAD`; `base` is then not consulted. */
  readonly uncommitted?: boolean;
  readonly reviewer: PerFileReviewer;
  /** `null` reports every finding. */
  readonly verifier?: PerFileVerifier | null;
  readonly git: GitReader;
  readonly settings: FileReviewSettings;
  readonly skills: SkillMatcher | null;
  /** Simultaneous file reviews (content read + model call). */
  readonly maxConcurrentFiles: number;
  /** Per-file cap; the most severe survive, the rest count as `capped`. `0` reports all. */
  readonly maxFindingsPerFile?: number;
  /** Reads the repository beyond the diff at `HEAD`; `null` gathers no pre-context. */
  readonly codeContext?: CodeContext | null;
  readonly logger?: Logger;
}

/**
 * Streams review records for `base...HEAD` (or the working tree).
 *
 * @returns One `finding` record per finding as each file completes, then a single `summary`.
 * @remarks The change set handed to pre-context is the selected set, so an excluded or credential file
 * cannot reach a prompt as a "related change".
 */
export async function* iterBranchReview(
  options: BranchReviewOptions,
): AsyncGenerator<BranchReviewRecord> {
  const { git } = options;
  const { base, branch } = reviewedReferences(options);
  const log = (options.logger ?? NULL_LOGGER).child("review.branch_review");

  const files = await changedFilesOf(options, log);
  const decisions = selectFiles(files, options.settings);
  const selected = selectedFiles(decisions);
  logSkips(decisions, options.logger);

  const limit = pLimit(options.maxConcurrentFiles);
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
      maxFindingsPerFile: options.maxFindingsPerFile ?? 0,
      ...(options.logger && { logger: options.logger }),
    });

  let filesReviewed = 0;
  let totalFindings = 0;
  let unanchored = 0;
  let refuted = 0;
  let capped = 0;
  let mislabelled = 0;
  let failed = 0;
  // A credential the per-file step refused although selection passed it; counted under `secret`.
  let guarded = 0;
  const anchors = new Map<string, number>();
  const filesWithFindings = new Set<string>();

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
    // Per-finding tallies are taken over reported findings only, so they describe one population.
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
    failed,
    truncated: selected.filter((decision) => decision.truncated).length,
    findings: totalFindings,
    files_with_findings: filesWithFindings.size,
    anchors: Object.fromEntries([...anchors].toSorted(([a], [b]) => compareCodePoints(a, b))),
    unanchored,
    refuted,
    capped,
    mislabelled,
    skipped: Object.fromEntries(
      [...withGuarded(skipCounts(decisions), guarded)].toSorted(([a], [b]) =>
        compareCodePoints(a, b),
      ),
    ),
  };
}

/** The skip counts with the per-file step's credential refusals folded into `secret`. */
function withGuarded(
  counts: ReadonlyMap<string, number>,
  guarded: number,
): ReadonlyMap<string, number> {
  if (guarded === 0) return counts;
  const merged = new Map(counts);
  merged.set("secret", (merged.get("secret") ?? 0) + guarded);
  return merged;
}

/** The two sides a review names. */
type ReviewScope = Pick<BranchReviewOptions, "base" | "uncommitted">;

/** The reviewed side: the checkout. Also what the working tree is reviewed against. */
export const HEAD = "HEAD";
/** How the summary names the working tree. */
export const WORKING_TREE = "working tree";

/** The two sides a run actually compared; an uncommitted review reports `HEAD` and `working tree`. */
function reviewedReferences(options: ReviewScope): { base: string; branch: string } {
  return options.uncommitted === true
    ? { base: HEAD, branch: WORKING_TREE }
    : { base: options.base, branch: HEAD };
}

/** How a report titles the scope it covered: `HEAD vs main`, or `working tree vs HEAD`. */
function scopeTitle(options: ReviewScope): string {
  const { base, branch } = reviewedReferences(options);
  return `${branch} vs ${base}`;
}

/** The changed files of the run's scope: the three-dot diff `base...HEAD`, or the uncommitted change set. */
async function changedFilesOf(
  options: ReviewScope & Pick<BranchReviewOptions, "git">,
  log: Logger,
): Promise<ChangedFileEntry[]> {
  const { base, git } = options;
  if (options.uncommitted === true) {
    const dirty = await git.worktreeFiles();
    log.info(`Working tree vs ${HEAD} in ${git.root}: ${dirty.length} uncommitted file(s).`);
    return dirty;
  }
  const forkPoint = await git.mergeBase(base, HEAD);
  if (forkPoint === null) {
    log.warn(`No merge-base for '${HEAD}' and '${base}'; comparing against '${base}' directly.`);
  }
  const files = await git.changedFiles(forkPoint ?? base, HEAD);
  log.info(`${HEAD} vs '${base}' in ${git.root}: ${files.length} changed file(s).`);
  return files;
}

/** Options for {@link previewBranch}: local git and the settings, no model. */
export interface BranchPreviewOptions {
  /** What the checkout is compared against. */
  readonly base: string;
  /** Preview the uncommitted change set instead of the checkout's. */
  readonly uncommitted?: boolean;
  readonly git: GitReader;
  readonly settings: FileReviewSettings;
  readonly logger?: Logger;
}

/**
 * What a review would review, without calling a model or needing a credential.
 *
 * @returns The decisions and the report text.
 */
export async function previewBranch(
  options: BranchPreviewOptions,
): Promise<{ decisions: FileDecision[]; report: string }> {
  const log = (options.logger ?? NULL_LOGGER).child("review.branch_review");
  const files = await changedFilesOf(options, log);
  const decisions = selectFiles(files, options.settings);
  return {
    decisions,
    report: previewReport(scopeTitle(options), decisions, options.settings.maxFileChars),
  };
}

/** A review collected into one result. */
export interface BranchReviewResult {
  readonly findings: readonly Omit<FindingRecord, "type">[];
  readonly files_changed: number;
  readonly files_reviewed: number;
  /** Files selected for review whose review did not finish. */
  readonly failed: number;
  /** Files whose diff was shown in part only. */
  readonly truncated: number;
  readonly anchors: Readonly<Record<string, number>>;
  readonly unanchored: number;
  readonly refuted: number;
  /** Findings `max-findings-per-file` withheld. */
  readonly capped: number;
  /** Reported findings re-rated from an unknown severity. */
  readonly mislabelled: number;
  /** Files not reviewed, by reason. */
  readonly skipped: Readonly<Record<string, number>>;
}

/** Runs {@link iterBranchReview} to completion and collects the result. */
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

/** The findings and the summary as one result; every tally is `0` without a summary. */
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
 * Feeds every record to a reporter as it is produced and returns the collected result.
 *
 * @returns The same result {@link reviewBranch} would give, so the caller can answer `--fail-on`.
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

/** What the text report needs; every tally may be absent. */
export interface TextReportInput {
  readonly findings: readonly Omit<FindingRecord, "type">[];
  readonly anchors?: Readonly<Record<string, number>>;
  /** Files selected for review whose review did not finish. */
  readonly failed?: number;
  /** Files whose diff was shown in part only. */
  readonly truncated?: number;
}

/** What a reader must know before believing the findings: failed and truncated files. */
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

/**
 * The human-readable report, as lines to print.
 *
 * @returns Header, count, notable anchor tallies, caveats, then findings by path and line (unanchored first).
 */
export function branchReviewText(base: string, branch: string, result: TextReportInput): string[] {
  const lines = [`\n=== Branch review: ${branch} vs ${base} ===`];
  const { findings } = result;
  if (findings.length === 0) {
    lines.push("No issues found.", ...caveats(result));
    return lines;
  }
  const files = new Set(findings.map((f) => f.path)).size;
  lines.push(`${findings.length} finding(s) across ${files} file(s).`);
  const notable = Object.entries(result.anchors ?? {})
    .filter(([name, n]) => name !== "exact" && n > 0)
    .toSorted(([a], [b]) => compareCodePoints(a, b));
  if (notable.length > 0) {
    lines.push(`anchors: ${notable.map(([name, n]) => `${n} ${name}`).join(", ")}`);
  }
  lines.push(...caveats(result), "");
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
