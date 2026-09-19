/**
 * A reporter that owns a resource (today: the `--out` file) and must hand it back.
 * @packageDocumentation
 */

import { type BranchReviewReporter } from "../../core/ports/review-reporter";

/** A reporter with something to release. */
export interface ClosableReporter extends BranchReviewReporter {
  /** Flushes every record reported so far and releases the resource. */
  close(): Promise<void>;
}

function isClosableReporter(reporter: BranchReviewReporter): reporter is ClosableReporter {
  return "close" in reporter && typeof reporter.close === "function";
}

/** Closes the reporter if it is closable; a reporter that owns nothing does nothing. */
export async function closeReporter(reporter: BranchReviewReporter): Promise<void> {
  if (isClosableReporter(reporter)) await reporter.close();
}
