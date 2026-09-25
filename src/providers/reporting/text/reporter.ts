/**
 * The human-readable rendering: collects the run and prints it on the closing record.
 * @packageDocumentation
 */

import { type LineWriter, type SummaryRecord } from "../../../core/ports/review-reporter";
import { branchReviewText } from "../../../core/review/branch-review";
import { CollectingReporter } from "../collecting";

/** Prints `branchReviewText` when the summary arrives. */
export class TextReporter extends CollectingReporter {
  constructor(private readonly write: LineWriter) {
    super();
  }

  /** `base` and `branch` come from the summary, so the heading names the refs actually compared. */
  protected onSummary(summary: SummaryRecord): void {
    // The whole summary: a caveat the text report can render must not depend on this list remembering it.
    const lines = branchReviewText(summary.base, summary.branch, {
      ...summary,
      findings: this.findings,
    });
    for (const line of lines) this.write(line);
  }
}
