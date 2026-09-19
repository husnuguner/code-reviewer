/**
 * The format-provider kind: the renderings `--format` may name. Builds the `BranchReviewReporter` port.
 * @packageDocumentation
 */

import {
  type BranchReviewReporter,
  type LineWriter,
  type SummaryWriter,
} from "../../core/ports/review-reporter";
import { Provider } from "../provider";
import { ProviderRegistry } from "../registry";

/** What a format writes through: lines, and a CI summary where one exists. */
export interface ReportContext {
  readonly write: LineWriter;
  /** `null` outside a CI runner. */
  readonly summary: SummaryWriter | null;
}

/** One rendering. */
export abstract class FormatProvider extends Provider<ReportContext, BranchReviewReporter> {}

/** The renderings, selectable by name. */
export class FormatProviderRegistry extends ProviderRegistry<
  ReportContext,
  BranchReviewReporter,
  FormatProvider
> {
  constructor(providers: readonly FormatProvider[] = []) {
    super("report format", providers);
  }
}
