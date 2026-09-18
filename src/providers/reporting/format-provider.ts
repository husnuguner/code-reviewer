/**
 * The format-provider kind: what a run may name in `--format`.
 *
 * A format provider builds the `BranchReviewReporter` port out of the two
 * functions a rendering can write through. Declaring a subclass and
 * listing an instance in `builtin.ts` is all it takes to make a
 * rendering selectable: the command line validates `--format` against the
 * registered names, its `--help` is generated from their descriptions, and
 * the composition root builds through the registry. Nothing asks "which
 * format is this?" anywhere else, so a fourth rendering (SARIF, JUnit, a
 * webhook) is a new class and one line in the built-in list -- not an edit to
 * a `switch` that three modules would otherwise have to agree on.
 */

import {
  type BranchReviewReporter,
  type LineWriter,
  type SummaryWriter,
} from "../../core/ports/review-reporter";
import { Provider } from "../provider";
import { ProviderRegistry } from "../registry";

/**
 * What a format is handed when it is built.
 *
 * Deliberately not a stream: a format writes lines and, where the environment
 * offers one, a summary. Two functions are all the core needs to know about
 * "output", and all a test needs to fake.
 */
export interface ReportContext {
  readonly write: LineWriter;
  /** `null` outside a CI runner, where there is no summary to append to. */
  readonly summary: SummaryWriter | null;
}

/** One rendering. Nothing beyond the mechanism; subclasses build their reporter. */
export abstract class FormatProvider extends Provider<ReportContext, BranchReviewReporter> {}

/** The renderings, selectable by name; nothing here is its own. */
export class FormatProviderRegistry extends ProviderRegistry<
  ReportContext,
  BranchReviewReporter,
  FormatProvider
> {
  constructor(providers: readonly FormatProvider[] = []) {
    super("report format", providers);
  }
}
