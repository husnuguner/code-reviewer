/**
 * NDJSON: one JSON record per line, written as soon as it is produced.
 * @packageDocumentation
 */

import {
  type BranchReviewRecord,
  type BranchReviewReporter,
  type LineWriter,
} from "../../../core/ports/review-reporter";

/** Serialises each record verbatim as one line. */
export class NdjsonReporter implements BranchReviewReporter {
  constructor(private readonly write: LineWriter) {}

  report(record: BranchReviewRecord): void {
    this.write(JSON.stringify(record));
  }
}
