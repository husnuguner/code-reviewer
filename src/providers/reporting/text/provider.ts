/** `text`: the default -- the whole run, rendered for a human when it finishes. */

import { type BranchReviewReporter } from "../../../core/ports/review-reporter";
import { FormatProvider, type ReportContext } from "../format-provider";

import { TextReporter } from "./reporter";

export class TextFormat extends FormatProvider {
  readonly name = "text";
  readonly description = "human-readable, printed when the run finishes (the default)";

  create(context: ReportContext): BranchReviewReporter {
    return new TextReporter(context.write);
  }
}
