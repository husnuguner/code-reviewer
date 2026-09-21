/**
 * The root logging flags as Commander returns them, and how they become settled settings.
 * @packageDocumentation
 */

import {
  type LogFormatChoice,
  type LogLevel,
  type LogSettings,
  resolveLogSettings,
} from "../../providers/logging/log-settings";
import { type ParsedOptions } from "../command-line";

/** The root command's logging flags. */
export interface LoggingArguments {
  /** `-v`. */
  readonly verbose: boolean;
  /** `-q`. */
  readonly quiet: boolean;
  /** `--log-level`; outranks both shorthands. */
  readonly logLevel: LogLevel | null;
  /** `--log-format`; `auto` reads the environment. */
  readonly logFormat: LogFormatChoice;
  /** `true` until `--no-color` is given. */
  readonly color: boolean;
}

/**
 * Settles the logging flags against the process environment.
 *
 * @remarks Resolved here, at the edge, so the container receives a decision and stays testable.
 */
export function logSettingsFrom(arguments_: LoggingArguments): LogSettings {
  return resolveLogSettings(
    {
      verbose: arguments_.verbose,
      quiet: arguments_.quiet,
      level: arguments_.logLevel,
      format: arguments_.logFormat,
      // Only the negation is a statement; `true` leaves colour to picocolors (`null`).
      // eslint-disable-next-line unicorn/prefer-logical-operator-over-ternary -- `color && null` would read as a slip, not a tri-state
      color: arguments_.color ? null : false,
    },
    { environment: process.env },
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
