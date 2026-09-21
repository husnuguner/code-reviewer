/**
 * Resolves what the operator asked of the logs (level, format, colour) from flags and environment,
 * once, in one pure function. The flags are the reviewer's own; the environment is only read for the
 * conventions other tools own (`RUNNER_DEBUG`, `GITHUB_ACTIONS`, no-color.org) -- there is no
 * `REVIEWER_LOG_*` variable, so a log setting is always visible on the command line that asked for it.
 * Colour support is picocolors' verdict (no-color.org, `FORCE_COLOR`, `TERM=dumb`, TTY, CI).
 * @packageDocumentation
 */

import pc from "picocolors";

/** How much a run says, loudest first; `silent` says nothing. */
export const LOG_LEVELS = ["debug", "info", "warn", "error", "silent"] as const;

/** One of {@link LOG_LEVELS}. */
export type LogLevel = (typeof LOG_LEVELS)[number];

/** The line shapes; `auto` resolves to `github` on a runner and `text` elsewhere. */
export const LOG_FORMATS = ["auto", "text", "json", "github"] as const;

/** One of {@link LOG_FORMATS}. */
export type LogFormatChoice = (typeof LOG_FORMATS)[number];

/** A resolved format. */
export type LogFormat = Exclude<LogFormatChoice, "auto">;

/** What the command line said about logging. */
export interface LoggingFlags {
  /** `-v`: debug detail, timestamps and component names. */
  readonly verbose?: boolean;
  /** `-q`: warnings and errors only. */
  readonly quiet?: boolean;
  /** `--log-level`; outranks `-v` and `-q`. */
  readonly level?: LogLevel | null;
  /** `--log-format`; `auto` decides from the environment. */
  readonly format?: LogFormatChoice | null;
  /** `--color`/`--no-color`; `null` when neither was given. */
  readonly color?: boolean | null;
}

/** Logging with nothing left to decide. */
export interface LogSettings {
  readonly level: LogLevel;
  readonly format: LogFormat;
  readonly color: boolean;
  /** Whether a line carries its timestamp and component name; on at `debug`. */
  readonly detailed: boolean;
  /** Values masked verbatim in every line. */
  readonly secrets: readonly string[];
}

/** An environment map. */
export type Environment = Readonly<Record<string, string | undefined>>;

/** Whether a variable is set to something; `""` counts as unset. */
function isSet(value: string | undefined): value is string {
  return value !== undefined && value !== "";
}

/** Whether a variable means "yes": set, and not `0` or `false`. */
function isTruthy(value: string | undefined): boolean {
  if (!isSet(value)) return false;
  const folded = value.trim().toLowerCase();
  return folded !== "0" && folded !== "false";
}

/** The threshold: `--log-level` › `-q` › `-v` › `RUNNER_DEBUG` › `info`. */
function resolveLevel(flags: LoggingFlags, environment: Environment): LogLevel {
  if (flags.level != null) return flags.level;
  if (flags.quiet === true) return "warn";
  if (flags.verbose === true) return "debug";
  return isTruthy(environment["RUNNER_DEBUG"]) || isTruthy(environment["ACTIONS_STEP_DEBUG"])
    ? "debug"
    : "info";
}

/** Whether the process runs as a GitHub Actions step. */
function isGitHubRunner(environment: Environment): boolean {
  return isTruthy(environment["GITHUB_ACTIONS"]);
}

/** The line shape: the flag, else `auto` resolved by the surroundings. */
function resolveFormat(flags: LoggingFlags, environment: Environment): LogFormat {
  const asked = flags.format ?? "auto";
  if (asked !== "auto") return asked;
  return isGitHubRunner(environment) ? "github" : "text";
}

/**
 * Whether log lines may be coloured: only `text`, the flag if given, else `isColorSupported`.
 *
 * @remarks `isColorSupported` defaults to picocolors' constant of that name, fixed once at import from the
 * process: `!(NO_COLOR || argv has --no-color) && (FORCE_COLOR || argv has --color || win32 ||
 * (stdout.isTTY && TERM !== "dumb") || CI)`, every variable read as a non-empty string (so
 * `FORCE_COLOR=0` forces colour on and `NO_COLOR=""` is unset). `--no-color` on argv is thus
 * honoured twice, by commander through the flag and by picocolors; the flag is consulted first.
 */
function shouldColor(flags: LoggingFlags, format: LogFormat, isColorSupported: boolean): boolean {
  return format === "text" ? (flags.color ?? isColorSupported) : false;
}

/** Variable names that say they hold a credential. */
const SECRET_NAME = /(?:API_?KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL)/iu;

/** The shortest value worth masking; shorter ones would redact innocent text. */
const SHORTEST_SECRET = 8;

/** The credential values in `environment`, longest first so a prefix cannot mask a longer one. */
export function secretsFrom(environment: Environment): readonly string[] {
  const values = new Set<string>();
  for (const [name, value] of Object.entries(environment)) {
    if (SECRET_NAME.test(name) && isSet(value) && value.length >= SHORTEST_SECRET) {
      values.add(value);
    }
  }
  return [...values].toSorted((a, b) => b.length - a.length);
}

/** What a masked secret is replaced with. */
export const SECRET_MASK = "***";

/**
 * Replaces every known secret with `***`.
 *
 * @remarks The replacement is a function so a secret containing `$&` cannot be expanded by `replaceAll`.
 */
export function redact(text: string, secrets: readonly string[]): string {
  let result = text;
  for (const secret of secrets) result = result.replaceAll(secret, () => SECRET_MASK);
  return result;
}

/** Options for {@link resolveLogSettings}. */
export interface ResolveOptions {
  readonly environment?: Environment;
  /** Whether the process may colour its output; picocolors' verdict when not stated. */
  readonly isColorSupported?: boolean;
}

/** Settles every logging question from the flags, the environment and the process's colour support. */
export function resolveLogSettings(
  flags: LoggingFlags = {},
  options: ResolveOptions = {},
): LogSettings {
  const environment = options.environment ?? {};
  const level = resolveLevel(flags, environment);
  const format = resolveFormat(flags, environment);
  return {
    level,
    format,
    color: shouldColor(flags, format, options.isColorSupported ?? pc.isColorSupported),
    detailed: level === "debug",
    secrets: secretsFrom(environment),
  };
}
