/**
 * `--config`: the flag every command that opens the catalogue shares, and
 * what a command that reviews nothing asks the container for.
 */

import { type Command } from "commander";

import { type ParsedOptions } from "../command-line";
import { type RunCradle, type RunRequest, buildContainer } from "../container";

import { DEFAULT_FORMAT } from "./format";
import { type LoggingArguments, logSettingsFrom, loggingArguments } from "./logging";

/** What every command that opens the catalogue takes: where it is, and how loud to be. */
export interface CatalogArguments extends LoggingArguments {
  /** `--config`: the catalogue's path, or `null` for the usual lookup. */
  readonly config: string | null;
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
  return { ...loggingArguments(options), config: options.config ?? null };
}

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
    logging: logSettingsFrom(arguments_),
    overrides: {},
    requiresModel: false,
    format: DEFAULT_FORMAT,
    outFile: null,
  };
}

/** The console, the paths and the logger, from the same root every command builds through. */
export type CatalogCradle = Pick<
  RunCradle,
  "console" | "catalogPath" | "configHomePath" | "logger"
>;

export function catalogCradle(arguments_: CatalogArguments): CatalogCradle {
  return buildContainer(catalogRequest(arguments_)).cradle;
}
