/**
 * The human-readable rendering: the whole run, printed when it is over.
 *
 * Unlike the streaming formats this one cannot write as it goes -- a report
 * that opens with "3 finding(s) across 2 file(s)" does not know those numbers
 * until the last file is done. So it collects, and renders on the closing
 * record.
 *
 * That it is a *reporter* at all, rather than something the command line does
 * after the run, is the point: every format goes through the same port, so
 * `--out` tees off any of them and no caller has to ask which format is in
 * play.
 */

import { type SummaryRecord } from "../../core/ports/review-reporter";
import { type LineWriter } from "../../core/reporting/format-registry";
import { branchReviewText } from "../../core/review/branch-review";

import { CollectingReporter } from "./collecting";

/** Collects a run and prints `branchReviewText` when the summary arrives. */
export class TextReporter extends CollectingReporter {
  constructor(private readonly write: LineWriter) {
    super();
  }

  /**
   * `base` and `branch` come from the summary record rather than from the
   * command line, so the heading can only ever name the refs the run
   * actually compared.
   */
  protected onSummary(summary: SummaryRecord): void {
    const lines = branchReviewText(summary.base, summary.branch, {
      findings: this.findings,
      anchors: summary.anchors,
    });
    for (const line of lines) this.write(line);
  }
}
