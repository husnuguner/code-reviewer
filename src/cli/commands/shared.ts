/**
 * What more than one command needs: the flag that names the catalogue and
 * the arguments it yields, the report-format registry the command line is
 * validated against, the severity-list parser every gate shares, and the
 * container request of a command that reviews nothing. Stated once here so
 * that no command module restates them.
 */

import { type Command } from "commander";

import { SEVERITIES, type Severity } from "../../core/review/severity";
import { builtinReportFormatRegistry } from "../../infra/reporters/index";
import { type OptionParser, type ParsedOptions, choice, listOf } from "../command-line";
import { type ReportFormat, type RunRequest } from "../container";

/** What every command that opens the catalogue takes: where it is, and how loud to be. */
export interface CatalogArguments {
  /** `--config`: the catalogue's path, or `null` for the usual lookup. */
  readonly config: string | null;
  /** `-v`, the root command's flag, read through the globals. */
  readonly verbose: boolean;
}

/** `--config`, the flag every command that opens the catalogue shares. */
export function catalogOptions(command: Command): Command {
  return command.option(
    "--config <path>",
    "Path to config.yaml (overrides REVIEWER_CONFIG and the default under the user config directory).",
  );
}

/** The catalogue arguments out of parsed options; a command's own come on top. */
export function catalogArguments(options: ParsedOptions<CatalogArguments>): CatalogArguments {
  return { config: options.config ?? null, verbose: options.verbose };
}

/**
 * The renderings `--format` may name.
 *
 * Built once, at module scope, because the command line is parsed before any
 * container exists: `--format` has to be validated against the same registry
 * the composition root later builds through, or the two could disagree about
 * what a valid format is.
 */
export const REPORT_FORMATS = builtinReportFormatRegistry();

/** The rendering a run takes when `--format` is not given: the first registered. */
export const DEFAULT_FORMAT: ReportFormat = REPORT_FORMATS.defaultName();

/**
 * A comma-separated list of severities, or `none`.
 *
 * Shared by every flag that gates on severity (`--fail-on`,
 * `--request-changes-on`), so "which words are allowed" is decided once, and
 * decided by the vocabulary rather than by a parser of its own. Spelling is
 * forgiven; what comes back is canonical.
 */
export const severityList: OptionParser<Severity[]> = listOf(
  choice(SEVERITIES, { label: "severities", caseInsensitive: true }),
  { none: "none" },
);

/**
 * The container request of a command that reviews nothing -- `init`,
 * `projects`, `add`. Resolution is lazy, so a container built from this only
 * ever yields the console, the paths and the logger; the format and the
 * model it names are never asked for.
 */
export function catalogRequest(arguments_: CatalogArguments): RunRequest {
  return {
    project: null,
    configFile: arguments_.config,
    verbose: arguments_.verbose,
    overrides: {},
    requiresModel: false,
    format: DEFAULT_FORMAT,
    outFile: null,
  };
}
