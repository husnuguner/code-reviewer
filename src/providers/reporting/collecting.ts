/**
 * The base of every whole-run rendering: collects findings as they pass, renders on the summary.
 * @packageDocumentation
 */

import {
  type BranchReviewRecord,
  type BranchReviewReporter,
  type FindingRecord,
  type SummaryRecord,
} from "../../core/ports/review-reporter";

/** A finding as the record stream carries it, minus the discriminator. */
export type CollectedFinding = Omit<FindingRecord, "type">;

/** Collects findings and defers rendering to the closing record. */
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

  /** Called per finding on arrival; the default only collects. */
  protected onFinding(_finding: CollectedFinding): void {
    // Collected only; rendered at the end.
  }

  /** Called on the closing record, when the whole run is known. */
  protected abstract onSummary(summary: SummaryRecord): void;
}
