/**
 * `github`: annotations on the changed lines plus a job summary.
 * @packageDocumentation
 */

import { type BranchReviewReporter } from "../../../core/ports/review-reporter";
import { FormatProvider, type ReportContext } from "../format-provider";

import { GithubReporter } from "./reporter";

/** The GitHub Actions rendering. */
export class GithubFormat extends FormatProvider {
  readonly name = "github";
  readonly description = "GitHub Actions annotations on the changed lines, plus a job summary";

  create(context: ReportContext): BranchReviewReporter {
    return new GithubReporter(context.write, context.summary);
  }
}
