/**
 * A reporter holding something the operating system lent it for the length of
 * the run, and which the run must therefore hand back.
 *
 * Only the `--out` file sink owns anything; every other rendering writes to a
 * stream it did not open. So this is an extra capability rather than part of
 * the output port: a format that owns nothing must not have to pretend it
 * does, and `closeReporter` asks the question of whatever the composition
 * root happened to build.
 */

import { type BranchReviewReporter } from "../../core/ports/review-reporter";

export interface ClosableReporter extends BranchReviewReporter {
  /** Flush every record already reported and release the resource. */
  close(): Promise<void>;
}

function isClosableReporter(reporter: BranchReviewReporter): reporter is ClosableReporter {
  return "close" in reporter && typeof reporter.close === "function";
}

/**
 * Hand back whatever the reporter borrowed, and report a write that failed.
 *
 * Asked of the reporter the container built, whatever it turned out to be: a
 * rendering that owns nothing answers by doing nothing, so the caller does
 * not have to know which one it got.
 */
export async function closeReporter(reporter: BranchReviewReporter): Promise<void> {
  if (isClosableReporter(reporter)) await reporter.close();
}
