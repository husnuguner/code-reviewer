/**
 * `text`: the default, rendered for a human when the run finishes.
 * @packageDocumentation
 */

import { type BranchReviewReporter } from "../../../core/ports/review-reporter";
import { FormatProvider, type ReportContext } from "../format-provider";

import { TextReporter } from "./reporter";

/** The human-readable rendering. */
export class TextFormat extends FormatProvider {
  readonly name = "text";
  readonly description = "human-readable, printed when the run finishes (the default)";

  create(context: ReportContext): BranchReviewReporter {
    return new TextReporter(context.write);
  }
}
