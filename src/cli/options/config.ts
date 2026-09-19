/**
 * `--config` and the container request of a command that reviews nothing.
 * @packageDocumentation
 */

import { type Command } from "commander";

import { type ParsedOptions } from "../command-line";
import { type RunCradle, type RunRequest, buildContainer } from "../container";

import { DEFAULT_FORMAT } from "./format";
import { type LoggingArguments, logSettingsFrom, loggingArguments } from "./logging";

/** What every command that opens the config files takes. */
export interface ConfigArguments extends LoggingArguments {
  /** `--config`: another file for the repository slot, or `null` for the usual lookup. */
  readonly config: string | null;
}

/** Adds `--config`. */
export function configOptions(command: Command): Command {
  return command.option(
    "--config <path>",
    "Path to a repository config.yaml, in place of the nearest .review/config.yaml (overrides REVIEWER_CONFIG). The machine's ~/.config/reviewer/config.yaml still sits underneath.",
  );
}

/** The config-file arguments out of parsed options. */
export function configArguments(options: ParsedOptions<ConfigArguments>): ConfigArguments {
  return { ...loggingArguments(options), config: options.config ?? null };
}

/** The container request of `init`: no model, and lazily only the console, paths and logger. */
export function configRequest(arguments_: ConfigArguments): RunRequest {
  return {
    configFile: arguments_.config,
    logging: logSettingsFrom(arguments_),
    overrides: {},
    requiresModel: false,
    format: DEFAULT_FORMAT,
    outFile: null,
  };
}

/** The slice of the cradle a config-file command uses. */
export type ConfigCradle = Pick<
  RunCradle,
  "console" | "configFilePaths" | "configHomePath" | "logger"
>;

/** Builds the container for a config-file command. */
export function configCradle(arguments_: ConfigArguments): ConfigCradle {
  return buildContainer(configRequest(arguments_)).cradle;
}
