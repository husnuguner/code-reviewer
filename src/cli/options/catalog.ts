/**
 * `--config` and the container request of a command that reviews nothing.
 * @packageDocumentation
 */

import { type Command } from "commander";

import { type ParsedOptions } from "../command-line";
import { type RunCradle, type RunRequest, buildContainer } from "../container";

import { DEFAULT_FORMAT } from "./format";
import { type LoggingArguments, logSettingsFrom, loggingArguments } from "./logging";

/** What every command that opens the catalogue takes. */
export interface CatalogArguments extends LoggingArguments {
  /** `--config`, or `null` for the usual lookup. */
  readonly config: string | null;
}

/** Adds `--config`. */
export function catalogOptions(command: Command): Command {
  return command.option(
    "--config <path>",
    "Path to config.yaml (overrides REVIEWER_CONFIG and the default under the user config directory).",
  );
}

/** The catalogue arguments out of parsed options. */
export function catalogArguments(options: ParsedOptions<CatalogArguments>): CatalogArguments {
  return { ...loggingArguments(options), config: options.config ?? null };
}

/** The container request of `init`, `projects`, `add`: no model, and lazily only the console, paths and logger. */
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

/** The slice of the cradle a catalogue command uses. */
export type CatalogCradle = Pick<
  RunCradle,
  "console" | "catalogPath" | "configHomePath" | "logger"
>;

/** Builds the container for a catalogue command. */
export function catalogCradle(arguments_: CatalogArguments): CatalogCradle {
  return buildContainer(catalogRequest(arguments_)).cradle;
}
