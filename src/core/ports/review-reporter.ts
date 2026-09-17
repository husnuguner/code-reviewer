/**
 * The output port: where a review's findings and summary go.
 *
 * The flows decide *what* was found; a reporter decides where that shows up.
 * The CLI ships two -- human-readable text and NDJSON on stdout -- and a UI
 * plugs in its own without the flows changing. Records carry the documented
 * wire keys (`path`, `line`, `start_line`, `anchor`, ...), so a reporter that
 * serialises them verbatim is already the NDJSON contract.
 */

/** One finding as branch review reports it, with the skills that shaped it. */
export interface FindingRecord {
  readonly type: "finding";
  readonly path: string;
  readonly line: number | null;
  readonly start_line: number | null;
  readonly anchor: string;
  readonly severity: string;
  readonly body: string;
  readonly example: string;
  readonly skills: readonly string[];
}

/** The closing record of a branch review: the run's tallies. */
export interface SummaryRecord {
  readonly type: "summary";
  readonly base: string;
  readonly branch: string;
  readonly files_changed: number;
  readonly files_reviewed: number;
  readonly findings: number;
  readonly files_with_findings: number;
  /** How each finding's line was decided, by anchor outcome, sorted by name. */
  readonly anchors: Readonly<Record<string, number>>;
  readonly unanchored: number;
  /** Findings the verification pass removed; `0` when none ran. */
  readonly refuted: number;
  /**
   * Findings `max-findings-per-file` withheld; `0` when the cap never bit.
   *
   * Counted rather than implied: without it, a file that found eight things
   * and reported three is indistinguishable from one that found three, and
   * the cap becomes a silent editor of the review.
   */
  readonly capped: number;
  /**
   * How many files each skip reason accounted for (`excluded`, `secret`,
   * `no_added_lines`, ...), reasons that skipped none omitted. This is what
   * makes `files_changed` minus `files_reviewed` answerable instead of
   * merely visible.
   */
  readonly skipped: Readonly<Record<string, number>>;
}

export type BranchReviewRecord = FindingRecord | SummaryRecord;

/** Receives branch-review records as they are produced. */
export interface BranchReviewReporter {
  report(record: BranchReviewRecord): void;
}

/** Receives free-form report text (a preview, a would-be report). */
export interface DryRunReporter {
  report(text: string): void;
}

/**
 * Receives the file selection `--preview` prints.
 *
 * Separate from `DryRunReporter` because the two answer different questions:
 * a dry run shows the review a model already produced, a preview shows the
 * scope no model was asked about.
 */
export interface PreviewReporter {
  report(text: string): void;
}
