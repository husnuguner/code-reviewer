/**
 * The logging flags: declared once on the root, read by every command.
 *
 * How loud a run is has nothing to do with which command it runs, so the
 * flags live on the root command and each subcommand reads them through its
 * globals. This module is the shape they come back in and how they become a
 * decision the container can take.
 */

import {
  type LogFormatChoice,
  type LogLevel,
  type LogSettings,
  resolveLogSettings,
} from "../../providers/logging/log-settings";
import { type ParsedOptions } from "../command-line";

/**
 * The root command's logging flags, as Commander hands them back.
 *
 * `color` is Commander's shape for `--no-color`: `true` until the flag is
 * given.
 */
export interface LoggingArguments {
  /** `-v`: debug detail, with timestamps and component names. */
  readonly verbose: boolean;
  /** `-q`: warnings and errors only. */
  readonly quiet: boolean;
  /** `--log-level`, outranking both shorthands. */
  readonly logLevel: LogLevel | null;
  /** `--log-format`; `auto` reads the environment. */
  readonly logFormat: LogFormatChoice;
  /** `--no-color` sets this to `false`. */
  readonly color: boolean;
}

/**
 * The logging flags as settled settings.
 *
 * Resolved here, at the edge, rather than in the container: the answer
 * depends on the process environment and on whether *stderr* is a terminal,
 * and a composition root that reached for those would be a composition root
 * no test could pin down. What the container receives is a decision.
 */
export function logSettingsFrom(arguments_: LoggingArguments): LogSettings {
  return resolveLogSettings(
    {
      verbose: arguments_.verbose,
      quiet: arguments_.quiet,
      level: arguments_.logLevel,
      format: arguments_.logFormat,
      // Commander cannot tell `--color` from the default, so only the
      // negation is a statement; `true` leaves the decision to the terminal.
      color: arguments_.color ? null : false,
    },
    { environment: process.env, isTTY: process.stderr.isTTY },
  );
}

/** The logging arguments out of parsed options, with Commander's `undefined` spelled `null`. */
export function loggingArguments(options: ParsedOptions<LoggingArguments>): LoggingArguments {
  return {
    verbose: options.verbose,
    quiet: options.quiet,
    logLevel: options.logLevel ?? null,
    logFormat: options.logFormat,
    color: options.color,
  };
}
