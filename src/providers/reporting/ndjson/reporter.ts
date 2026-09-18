/**
 * NDJSON: one JSON record per line, written through as soon as it is produced.
 *
 * Each line is flushed immediately, so a caller reading stdout line-by-line
 * can parse each record as it arrives. Logs never come here: they go to
 * stderr through the logger.
 *
 * NDJSON is also the machine contract this tool ends at. It reports; whatever
 * turns a finding into a pull-request comment (a CI bot, a dashboard) reads
 * these records, which is why the file sink beside this exists at all.
 */

import {
  type BranchReviewRecord,
  type BranchReviewReporter,
  type LineWriter,
} from "../../../core/ports/review-reporter";

export class NdjsonReporter implements BranchReviewReporter {
  constructor(private readonly write: LineWriter) {}

  report(record: BranchReviewRecord): void {
    this.write(JSON.stringify(record));
  }
}
