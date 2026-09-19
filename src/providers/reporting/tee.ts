/**
 * Fans one record out to several reporters, in order. What makes `--out` orthogonal to `--format`.
 * @packageDocumentation
 */

import {
  type BranchReviewRecord,
  type BranchReviewReporter,
} from "../../core/ports/review-reporter";

import { type ClosableReporter, closeReporter } from "./closable";

/** Reports to every member. */
export class TeeReporter implements ClosableReporter {
  constructor(private readonly reporters: readonly BranchReviewReporter[]) {}

  report(record: BranchReviewRecord): void {
    for (const reporter of this.reporters) reporter.report(record);
  }

  /** Closes the members in order; a failing close stops the walk, since it is the one worth reporting. */
  async close(): Promise<void> {
    for (const reporter of this.reporters) await closeReporter(reporter);
  }
}
