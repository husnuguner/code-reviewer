/**
 * The output port: the records a review produces and the sinks that receive them.
 * @packageDocumentation
 */

/** One finding as branch review reports it. Field names are the NDJSON wire spelling. */
export interface FindingRecord {
  readonly type: "finding";
  readonly path: string;
  readonly line: number | null;
  readonly start_line: number | null;
  readonly anchor: string;
  readonly severity: string;
  readonly body: string;
  readonly example: string;
  /** The skills that were in the prompt for this file. */
  readonly skills: readonly string[];
}

/**
 * The closing record of a branch review.
 *
 * @remarks `files_changed = files_reviewed + failed + sum(skipped)`. `anchors`, `unanchored` and
 * `mislabelled` are counted over reported findings; `refuted` and `capped` over what never was.
 */
export interface SummaryRecord {
  readonly type: "summary";
  readonly base: string;
  readonly branch: string;
  readonly files_changed: number;
  readonly files_reviewed: number;
  /** Files selected for review whose review threw. */
  readonly failed: number;
  /** Files whose diff was cut at `max-file-chars`. */
  readonly truncated: number;
  readonly findings: number;
  readonly files_with_findings: number;
  /** Reported findings by anchor outcome, sorted by name. */
  readonly anchors: Readonly<Record<string, number>>;
  /** Reported findings with no line. */
  readonly unanchored: number;
  /** Findings the verification pass removed; `0` when none ran. */
  readonly refuted: number;
  /** Findings `max-findings-per-file` withheld. */
  readonly capped: number;
  /** Reported findings re-rated to the mildest severity because the model named an unknown one. */
  readonly mislabelled: number;
  /** Files not reviewed, by reason; reasons that skipped none omitted. */
  readonly skipped: Readonly<Record<string, number>>;
}

/** Any branch-review record. */
export type BranchReviewRecord = FindingRecord | SummaryRecord;

/** Receives branch-review records as they are produced. */
export interface BranchReviewReporter {
  report(record: BranchReviewRecord): void;
}

/** Writes one line of output. */
export type LineWriter = (text: string) => void;

/** Appends Markdown to a CI job summary, where the environment offers one. */
export type SummaryWriter = (markdown: string) => void;

/** Receives the review a dry run would have posted. */
export interface DryRunReporter {
  report(text: string): void;
}

/** Receives the file selection `--preview` prints. */
export interface PreviewReporter {
  report(text: string): void;
}
