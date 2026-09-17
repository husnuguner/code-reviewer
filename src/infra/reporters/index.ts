/**
 * The built-in report formats, ready to register.
 *
 * To add a rendering -- SARIF, JUnit, a webhook POST -- write its reporter
 * beside these and list it here. Nothing else changes: the command line
 * validates `--format` against the registry's names and generates its help
 * from these descriptions, and the composition root builds through it. There
 * is no `switch` on the format anywhere, which is the point: a fourth
 * rendering cannot be half-added.
 *
 * The order here is the order `--help` lists them in, so the default comes
 * first.
 */

import {
  type ReportContext,
  type ReportFormat,
  ReportFormatRegistry,
} from "../../core/reporting/format-registry";

import { GithubReporter } from "./github";
import { NdjsonReporter } from "./stdout";
import { TextReporter } from "./text";

/** The default: the whole run, rendered for a human when it finishes. */
export const textFormat: ReportFormat = {
  name: "text",
  description: "human-readable, printed when the run finishes (the default)",
  build: (context: ReportContext) => new TextReporter(context.write),
};

/** The machine contract: one record per line, flushed as each file completes. */
export const ndjsonFormat: ReportFormat = {
  name: "ndjson",
  description: "one JSON record per line on stdout, for programmatic consumers",
  build: (context: ReportContext) => new NdjsonReporter(context.write),
};

/** CI: annotations on the changed lines, plus a job summary. */
export const githubFormat: ReportFormat = {
  name: "github",
  description: "GitHub Actions annotations on the changed lines, plus a job summary",
  build: (context: ReportContext) => new GithubReporter(context.write, context.summary),
};

export const BUILTIN_REPORT_FORMATS = [textFormat, ndjsonFormat, githubFormat] as const;

export function builtinReportFormatRegistry(): ReportFormatRegistry {
  return new ReportFormatRegistry(BUILTIN_REPORT_FORMATS);
}
