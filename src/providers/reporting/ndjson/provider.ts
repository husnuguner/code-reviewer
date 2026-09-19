/**
 * `ndjson`: the machine contract, one record per line.
 * @packageDocumentation
 */

import { type BranchReviewReporter } from "../../../core/ports/review-reporter";
import { FormatProvider, type ReportContext } from "../format-provider";

import { NdjsonReporter } from "./reporter";

/** The NDJSON rendering. */
export class NdjsonFormat extends FormatProvider {
  readonly name = "ndjson";
  readonly description = "one JSON record per line on stdout, for programmatic consumers";

  create(context: ReportContext): BranchReviewReporter {
    return new NdjsonReporter(context.write);
  }
}
