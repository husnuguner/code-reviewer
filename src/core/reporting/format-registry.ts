/**
 * The report-format registry: what a run may name in `--format`.
 *
 * A format is a small strategy with a `name`, a line of help text and a
 * factory. Declaring one and registering it is all it takes to make it
 * selectable: the command line validates `--format` against the registered
 * names, its `--help` is generated from their descriptions, and the
 * composition root builds through the registry. Nothing asks "which format is
 * this?" anywhere else, so a fourth rendering (SARIF, JUnit, a webhook) is a
 * new file and one line in the built-in list -- not an edit to a `switch` that
 * three modules would otherwise have to agree on.
 *
 * The core owns the registry so that the command line can validate a format
 * without importing a single writer; `infra/reporters/index.ts` registers the
 * concrete ones at composition time.
 */

import { type BranchReviewReporter } from "../ports/review-reporter";
import { DescribedRegistry, type DescribedEntry } from "../util/registry";

/** Writes one line of a run's output. */
export type LineWriter = (text: string) => void;

/** Appends Markdown to a CI job summary. */
export type SummaryWriter = (markdown: string) => void;

/**
 * What a format is handed when it is built.
 *
 * Deliberately not a stream: a format writes lines and, where the environment
 * offers one, a summary. Keeping it to two functions is what lets the core
 * declare this contract without knowing what a file or a runner is, and what
 * lets a test collect output into an array.
 */
export interface ReportContext {
  readonly write: LineWriter;
  /** `null` outside a CI runner, where there is no summary to append to. */
  readonly summary: SummaryWriter | null;
}

/** Everything the registry needs to know about one rendering. */
export interface ReportFormat extends DescribedEntry {
  /** Unique id used in `--format`. */
  readonly name: string;
  /** One line, shown in `--help`. */
  readonly description: string;
  /** Build the reporter this format renders through. */
  build(context: ReportContext): BranchReviewReporter;
}

/**
 * A `DescribedRegistry` of renderings: selection, listing, generated help and
 * the refusal a wrong `--format` meets are the shared ones, and building a
 * reporter out of the context is the only part that is this registry's own.
 */
export class ReportFormatRegistry extends DescribedRegistry<ReportFormat> {
  constructor(formats: readonly ReportFormat[] = []) {
    super("report format", formats);
  }

  /** The reporter `name` describes. */
  build(name: string, context: ReportContext): BranchReviewReporter {
    return this.get(name).build(context);
  }
}
