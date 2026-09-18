/**
 * One record to several reporters, in order.
 *
 * What makes `--out` orthogonal to `--format`: a CI run wants annotations on
 * the diff *and* a machine-readable copy for whatever posts the comments, and
 * a model call is far too expensive to make twice for two renderings of one
 * answer.
 */

import {
  type BranchReviewRecord,
  type BranchReviewReporter,
} from "../../core/ports/review-reporter";

import { type ClosableReporter, closeReporter } from "./closable";

export class TeeReporter implements ClosableReporter {
  constructor(private readonly reporters: readonly BranchReviewReporter[]) {}

  report(record: BranchReviewRecord): void {
    for (const reporter of this.reporters) reporter.report(record);
  }

  /**
   * Close the members that own something, in order.
   *
   * A member whose close fails stops the walk, which is the honest reading:
   * at most one of these owns a file, and its failure is the one worth
   * reporting rather than swallowing to reach the renderings that cannot fail.
   */
  async close(): Promise<void> {
    for (const reporter of this.reporters) await closeReporter(reporter);
  }
}
