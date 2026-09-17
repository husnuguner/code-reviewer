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

import {
  type BranchReviewRecord,
  type BranchReviewReporter,
  type FindingRecord,
  type SummaryRecord,
} from "../../core/ports/review-reporter";
import { type LineWriter } from "../../core/reporting/format-registry";
import { branchReviewText } from "../../core/review/branch-review";

/** Collects a run and prints `branchReviewText` when the summary arrives. */
export class TextReporter implements BranchReviewReporter {
  private readonly findings: Omit<FindingRecord, "type">[] = [];

  constructor(private readonly write: LineWriter) {}

  report(record: BranchReviewRecord): void {
    if (record.type === "finding") {
      const { type: _type, ...finding } = record;
      this.findings.push(finding);
      return;
    }
    this.flush(record);
  }

  /**
   * Print the report. `base` and `branch` come from the summary record rather
   * than from the command line, so the heading can only ever name the refs
   * the run actually compared.
   */
  private flush(summary: SummaryRecord): void {
    const lines = branchReviewText(summary.base, summary.branch, {
      findings: this.findings,
      anchors: summary.anchors,
    });
    for (const line of lines) this.write(line);
  }
}
