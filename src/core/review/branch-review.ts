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

import { addedLines } from "../diff/patch-view";
import { type ChangedFileEntry } from "../domain/changed-file";
import { type CodeContext } from "../ports/code-context";
import { type GitReader } from "../ports/git-reader";
import { type Logger, NULL_LOGGER } from "../ports/logger";
import {
  type BranchReviewRecord,
  type BranchReviewReporter,
  type BypassMarkerRecord,
  type BypassRegionRecord,
  type FindingRecord,
  type SummaryRecord,
} from "../ports/review-reporter";
import { type SkillMatcher } from "../ports/skill-matcher";
import { asCompleted } from "../util/as-completed";
import { errorMessage } from "../util/errors";
import { compareCodePoints } from "../util/text";

import {
  bypassAddedWarning,
  bypassWarning,
  markerRecords,
  regionRecords,
  sortedMarkers,
  sortedRegions,
} from "./bypass";
import { type PolicyPath, policyChanges, policyWarning } from "./policy";
import { incrementalNote, previewReport, textBody } from "./render";
import {
  type FileOutcome,
  type FileReviewSettings,
  type PerFileReviewer,
  type PerFileVerifier,
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
  /**
   * Review only the commits after this one: the diff `since..HEAD`, with `base` not consulted. For a run
   * that should look at what one push added and nothing before it.
   */
  readonly since?: string;
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
  /** Where this run's policy lives inside the checkout, beside `.review`; a change to any of it is reported. */
  readonly policyPaths?: readonly PolicyPath[];
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
  const policy = policyChanges(files, options.policyPaths ?? []);
  if (policy.length > 0) log.warn(policyWarning(policy));
  const decisions = selectFiles(files, options.settings);
  const selected = selectedFiles(decisions);
  logSkips(decisions, options.logger);

  const limit = pLimit(options.maxConcurrentFiles);
  const changeSet = selected.map((decision) => decision.file);
  const provenance = await changeProvenance(options, log);
  const reviewOne = async (decision: SelectedFile): Promise<FileOutcome> => {
    try {
      return await reviewChangedFile(decision, {
        reviewer: options.reviewer,
        verifier: options.verifier ?? null,
        settings: options.settings,
        skills: options.skills,
        limit,
        // The file as the diff has it: the working tree for uncommitted work, else the commit under
        // review -- a local tree with edits not yet committed must not stand in for `HEAD`.
        readContent: (path) =>
          options.uncommitted === true ? git.readFile(path) : git.readFileAt(HEAD, path),
        codeContext: options.codeContext ?? null,
        changeSet,
        maxFindingsPerFile: options.maxFindingsPerFile ?? 0,
        ...(provenance !== null && {
          changeAddedLines: provenance.get(decision.path) ?? new Set<number>(),
        }),
        ...(options.logger && { logger: options.logger }),
      });
    } catch (error) {
      throw new FileReviewFailure(decision.path, error);
    }
  };

  let filesReviewed = 0;
  let totalFindings = 0;
  let unanchored = 0;
  let refuted = 0;
  let capped = 0;
  let mislabelled = 0;
  let failed = 0;
  // Findings that fell in a bypassed region, and files whose every added line did.
  let bypassed = 0;
  let bypassedFiles = 0;
  const regions: BypassRegionRecord[] = [];
  const addedMarkers: BypassMarkerRecord[] = [];
  // A credential the per-file step refused although selection passed it; counted under `secret`.
  let guarded = 0;
  const anchors = new Map<string, number>();
  const filesWithFindings = new Set<string>();

  const outcomes = asCompleted(selected.map((decision) => reviewOne(decision)));
  for await (const outcome of outcomes) {
    if (!outcome.ok) {
      failed++;
      const { error } = outcome;
      log.warn(
        error instanceof FileReviewFailure
          ? `Could not review ${error.path}: ${error.message}; it is counted as failed, not as clean.`
          : `Reviewing a file on '${branch}' failed: ${errorMessage(error)}`,
      );
      continue;
    }
    if (outcome.value.kind === "guarded") {
      guarded++;
      continue;
    }
    if (outcome.value.kind === "bypassed") {
      bypassedFiles++;
      bypassed += outcome.value.lines;
      regions.push(...regionRecords(outcome.value.path, outcome.value.regions));
      addedMarkers.push(...markerRecords(outcome.value.path, outcome.value.addedMarkers));
      continue;
    }
    const result = outcome.value.file;
    filesReviewed++;
    refuted += result.refuted;
    bypassed += result.bypassed;
    regions.push(...regionRecords(result.path, result.bypassRegions));
    addedMarkers.push(...markerRecords(result.path, result.addedMarkers));
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
    incremental: options.since !== undefined,
    files_changed: files.length,
    files_reviewed: filesReviewed,
    failed,
    findings: totalFindings,
    files_with_findings: filesWithFindings.size,
    anchors: Object.fromEntries([...anchors].toSorted(([a], [b]) => compareCodePoints(a, b))),
    unanchored,
    refuted,
    capped,
    mislabelled,
    bypassed,
    skipped: Object.fromEntries(
      [
        ...withPerFileSkips(skipCounts(decisions), { secret: guarded, bypassed: bypassedFiles }),
      ].toSorted(([a], [b]) => compareCodePoints(a, b)),
    ),
    policy_changed: policy,
    bypass_regions: sortedRegions(regions),
    bypass_added: sortedMarkers(addedMarkers),
  };
}

/**
 * For a `--since` run, the lines the whole change added to each file, relative to what it merges into
 * (`base`); `null` for any other run, whose reviewed diff already starts where the change does.
 *
 * @remarks A bypass marker is the change's own when it sits on one of these lines, and the change cannot
 * take its own code out of its own review. Without it, a marker one push added would be a context line to
 * the next push's `--since` run -- and honoured before anyone merged it. When the merge-base cannot be
 * found, the reviewed diff decides and the log says so.
 */
async function changeProvenance(
  options: Pick<BranchReviewOptions, "base" | "since" | "uncommitted" | "git">,
  log: Logger,
): Promise<ReadonlyMap<string, ReadonlySet<number>> | null> {
  if (options.since === undefined || options.uncommitted === true) return null;
  const forkPoint = await options.git.mergeBase(options.base, HEAD);
  if (forkPoint === null) {
    log.info(
      `No merge-base for '${HEAD}' and '${options.base}': bypass markers added before '${options.since}' are taken as merged.`,
    );
    return null;
  }
  const whole = await options.git.changedFiles(forkPoint, HEAD);
  return new Map(whole.map((file) => [file.filename, addedLines(file.patch)]));
}

/** A selected file whose review threw, with the file it was about, so the log can name it. */
class FileReviewFailure extends Error {
  override readonly name = "FileReviewFailure";

  constructor(
    readonly path: string,
    cause: unknown,
  ) {
    super(errorMessage(cause), { cause });
  }
}

/**
 * The skip counts with the per-file step's own refusals folded in: a credential it would not read under
 * `secret`, a file whose every added line was bypassed under `bypassed`.
 */
function withPerFileSkips(
  counts: ReadonlyMap<string, number>,
  extra: Readonly<Record<string, number>>,
): ReadonlyMap<string, number> {
  const merged = new Map(counts);
  for (const [reason, n] of Object.entries(extra)) {
    if (n > 0) merged.set(reason, (merged.get(reason) ?? 0) + n);
  }
  return merged;
}

/** The two sides a review names. */
type ReviewScope = Pick<BranchReviewOptions, "base" | "uncommitted" | "since">;

/** The reviewed side: the checkout. Also what the working tree is reviewed against. */
export const HEAD = "HEAD";
/** How the summary names the working tree. */
export const WORKING_TREE = "working tree";

/**
 * The two sides a run actually compared; an uncommitted review reports `HEAD` and `working tree`, a
 * `--since` run the commit it started from.
 */
function reviewedReferences(options: ReviewScope): { base: string; branch: string } {
  return options.uncommitted === true
    ? { base: HEAD, branch: WORKING_TREE }
    : { base: options.since ?? options.base, branch: HEAD };
}

/** How a report titles the scope it covered: `HEAD vs main`, or `working tree vs HEAD`. */
function scopeTitle(options: ReviewScope): string {
  const { base, branch } = reviewedReferences(options);
  return `${branch} vs ${base}`;
}

/**
 * The changed files of the run's scope: the three-dot diff `base...HEAD`, the commits since a given one,
 * or the uncommitted change set.
 *
 * @remarks `since` is expected to be an ancestor of `HEAD`; when it is not, the diff starts at their
 * merge-base, which reviews more than the push added, never less.
 */
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
  if (options.since !== undefined) {
    const files = await git.changedFiles(options.since, HEAD);
    log.info(
      `${HEAD} since '${options.since}' in ${git.root}: ${files.length} changed file(s); earlier commits are not reviewed.`,
    );
    return files;
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
  /** Preview only the commits after this one. */
  readonly since?: string;
  readonly git: GitReader;
  readonly settings: FileReviewSettings;
  /** As in {@link BranchReviewOptions.policyPaths}. */
  readonly policyPaths?: readonly PolicyPath[];
  readonly logger?: Logger;
}

/**
 * What a review would review, without calling a model or needing a credential.
 *
 * @returns The decisions, the policy files the change edits, and the report text.
 */
export async function previewBranch(
  options: BranchPreviewOptions,
): Promise<{ decisions: FileDecision[]; policyChanged: string[]; report: string }> {
  const log = (options.logger ?? NULL_LOGGER).child("review.branch_review");
  const files = await changedFilesOf(options, log);
  const policyChanged = policyChanges(files, options.policyPaths ?? []);
  const decisions = selectFiles(files, options.settings);
  return {
    decisions,
    policyChanged,
    report: previewReport(scopeTitle(options), decisions, policyChanged),
  };
}

/** A review collected into one result. */
export interface BranchReviewResult {
  readonly findings: readonly Omit<FindingRecord, "type">[];
  /** Whether only the commits after `--since` were reviewed. */
  readonly incremental: boolean;
  readonly files_changed: number;
  readonly files_reviewed: number;
  /** Files selected for review whose review did not finish. */
  readonly failed: number;
  readonly anchors: Readonly<Record<string, number>>;
  readonly unanchored: number;
  readonly refuted: number;
  /** Findings `max-findings-per-file` withheld. */
  readonly capped: number;
  /** Reported findings re-rated from an unknown severity. */
  readonly mislabelled: number;
  /** Added lines in a bypassed region, not shown to the model; a wholly bypassed file's included. */
  readonly bypassed: number;
  /** Files not reviewed, by reason. */
  readonly skipped: Readonly<Record<string, number>>;
  /** The policy files this change edits; `[]` when none. */
  readonly policy_changed: readonly string[];
  /** The regions bypass markers took out of review; `[]` when none. */
  readonly bypass_regions: readonly BypassRegionRecord[];
  /** Markers the change added itself, not honoured until merged; `[]` when none. */
  readonly bypass_added: readonly BypassMarkerRecord[];
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
    incremental: summary?.incremental ?? false,
    files_changed: summary?.files_changed ?? 0,
    files_reviewed: summary?.files_reviewed ?? 0,
    failed: summary?.failed ?? 0,
    anchors: summary?.anchors ?? {},
    unanchored: summary?.unanchored ?? 0,
    refuted: summary?.refuted ?? 0,
    capped: summary?.capped ?? 0,
    mislabelled: summary?.mislabelled ?? 0,
    bypassed: summary?.bypassed ?? 0,
    skipped: summary?.skipped ?? {},
    policy_changed: summary?.policy_changed ?? [],
    bypass_regions: summary?.bypass_regions ?? [],
    bypass_added: summary?.bypass_added ?? [],
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
  /** Whether only the commits after `base` were reviewed. */
  readonly incremental?: boolean;
  readonly anchors?: Readonly<Record<string, number>>;
  /** Files selected for review whose review did not finish. */
  readonly failed?: number;
  /** The policy files this change edits. */
  readonly policy_changed?: readonly string[];
  /** Findings that fell in a bypassed region. */
  readonly bypassed?: number;
  /** The regions bypass markers took out of review. */
  readonly bypass_regions?: readonly BypassRegionRecord[];
  /** Markers the change added itself, not honoured until merged. */
  readonly bypass_added?: readonly BypassMarkerRecord[];
}

/**
 * What a reader must know before believing the findings: failed files, a policy the change itself edits,
 * and the regions the code took out of its own review.
 */
function caveats(result: TextReportInput, base: string): string[] {
  const failed = result.failed ?? 0;
  const bypassed = result.bypassed ?? 0;
  const policy = policyWarning(result.policy_changed ?? []);
  const bypass = bypassWarning(result.bypass_regions ?? []);
  const requested = bypassAddedWarning(result.bypass_added ?? []);
  return [
    ...(result.incremental === true ? [incrementalNote(base)] : []),
    ...(failed > 0 ? [`${failed} file(s) could not be reviewed; the log says why.`] : []),
    ...(policy === "" ? [] : [policy]),
    ...(bypass === "" ? [] : [bypass]),
    ...(bypassed > 0 ? [`${bypassed} added line(s) in bypassed regions were not reviewed.`] : []),
    ...(requested === "" ? [] : [requested]),
  ];
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
    // A run that could not review a file has not found it clean, and must not read as if it had.
    const verdict =
      (result.failed ?? 0) > 0
        ? "Review incomplete: no issues found in the files that were reviewed."
        : "No issues found.";
    lines.push(verdict, ...caveats(result, base));
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
  lines.push(...caveats(result, base), "");
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
