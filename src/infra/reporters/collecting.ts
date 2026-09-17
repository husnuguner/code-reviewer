/**
 * The shape every whole-run rendering shares.
 *
 * A stream of records ends in one summary, and a rendering that needs the
 * whole run -- a table, a headline count, a report with a heading -- cannot
 * write until it arrives. So it collects the findings as they pass, and
 * renders on the closing record. Two reporters did exactly that by copy; a
 * third would have made a third copy. The collecting lives here once, and a
 * rendering states only what it does with a finding as it passes (often
 * nothing) and what it does with the whole run at the end.
 */

import {
  type BranchReviewRecord,
  type BranchReviewReporter,
  type FindingRecord,
  type SummaryRecord,
} from "../../core/ports/review-reporter";

/** A finding as the record stream carries it, minus the discriminator. */
export type CollectedFinding = Omit<FindingRecord, "type">;

export abstract class CollectingReporter implements BranchReviewReporter {
  /** Every finding seen so far, in arrival order. */
  protected readonly findings: CollectedFinding[] = [];

  report(record: BranchReviewRecord): void {
    if (record.type === "summary") {
      this.onSummary(record);
      return;
    }
    const { type: _type, ...finding } = record;
    this.findings.push(finding);
    this.onFinding(finding);
  }

  /**
   * A finding, the moment it arrives. Override to stream something per
   * finding; the default keeps it for the summary and says nothing.
   */
  protected onFinding(_finding: CollectedFinding): void {
    // Collected only; rendered at the end.
  }

  /** The closing record: the whole run is now known. */
  protected abstract onSummary(summary: SummaryRecord): void;
}
