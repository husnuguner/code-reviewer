/**
 * What the operator asked of the logs, settled once.
 *
 * Three questions -- how much to say, in what shape, and in colour or not --
 * are each answered from several places: a flag, an environment variable, a
 * CI runner's own switch, the terminal itself. Answering them where the
 * logger is built would scatter that precedence across the composition root
 * and make it untestable, so it is decided here, in one pure function of
 * (flags, environment, terminal), and the logger receives a settled
 * `LogSettings` with nothing left to interpret.
 *
 * The conventions followed are the ones a CLI user already knows, so that
 * this tool behaves like the others in their pipeline:
 *
 * - `-q`/`-v`/`--log-level`, and `REVIEWER_LOG_LEVEL` under them
 *   (clig.dev, "Arguments and flags").
 * - `NO_COLOR` disables colour whatever else is true; `FORCE_COLOR` and
 *   `CLICOLOR_FORCE` demand it even off a terminal; `TERM=dumb` and a
 *   non-TTY disable it (no-color.org, bixense.com/clicolors).
 * - A GitHub runner sets `RUNNER_DEBUG=1` when a job is re-run with debug
 *   logging, which is the operator asking this tool for debug too.
 */

/** How much a run says, loudest first; `silent` says nothing at all. */
export const LOG_LEVELS = ["debug", "info", "warn", "error", "silent"] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

/**
 * The shape of a log line.
 *
 * - `text` -- for a person: `info: message`, or the full record under `-v`.
 * - `json` -- one JSON object per line, for whatever collects logs.
 * - `github` -- workflow commands (`::debug::`, `::warning::`, `::error::`),
 *   so a runner folds and colours the lines itself.
 *
 * `auto` is not one of them: it is the *absence* of a choice, resolved to
 * `github` on a runner and `text` everywhere else.
 */
export const LOG_FORMATS = ["auto", "text", "json", "github"] as const;

export type LogFormatChoice = (typeof LOG_FORMATS)[number];

export type LogFormat = Exclude<LogFormatChoice, "auto">;

/** What the command line said about logging, before anything is resolved. */
export interface LoggingFlags {
  /** `-v`: debug detail, timestamps and component names. */
  readonly verbose?: boolean;
  /** `-q`: warnings and errors only. */
  readonly quiet?: boolean;
  /** `--log-level`: the exact threshold, outranking `-v` and `-q`. */
  readonly level?: LogLevel | null;
  /** `--log-format`; `auto` (the default) decides from the environment. */
  readonly format?: LogFormatChoice | null;
  /** `--color`/`--no-color`; `null` when neither was given. */
  readonly color?: boolean | null;
}

/** Logging with nothing left to decide. */
export interface LogSettings {
  readonly level: LogLevel;
  readonly format: LogFormat;
  readonly color: boolean;
  /**
   * Whether a line carries its timestamp and component name.
   *
   * Off by default because stderr is not a log file: a person running the
   * command wants the sentence, not the record around it (clig.dev, "Don't
   * treat stderr like a log file"). `-v` is them asking for the record.
   */
  readonly detailed: boolean;
  /**
   * Values that must never reach a log line, whatever a message was built
   * from. Masked verbatim, so this is precise rather than a guess at what a
   * secret looks like.
   */
  readonly secrets: readonly string[];
}

/** The environment, as much of it as this module reads. */
export type Environment = Readonly<Record<string, string | undefined>>;

/** A variable that is set to something; `""` counts as unset throughout. */
function isSet(value: string | undefined): value is string {
  return value !== undefined && value !== "";
}

/** A variable meaning "yes" unless it explicitly says `0` or `false`. */
function isTruthy(value: string | undefined): boolean {
  if (!isSet(value)) return false;
  const folded = value.trim().toLowerCase();
  return folded !== "0" && folded !== "false";
}

/** A level name, however it was spelled, or `null` if it names no level. */
export function parseLogLevel(value: string | undefined): LogLevel | null {
  if (!isSet(value)) return null;
  const folded = value.trim().toLowerCase();
  // `warning` is what a Python-shaped log calls it, and operators type it.
  const name = folded === "warning" ? "warn" : folded;
  return (LOG_LEVELS as readonly string[]).includes(name) ? (name as LogLevel) : null;
}

/**
 * The threshold, from the most specific source that named one.
 *
 * `--log-level` is an exact answer and outranks the two shorthands. Between
 * those, `-q` wins: `-v -q` is a contradiction, and the reading that
 * silences output is the one that cannot flood a script that asked for
 * quiet. `RUNNER_DEBUG` comes last of the *requests*, above only the
 * default, because it is the runner speaking for an operator who re-ran the
 * job asking to see more.
 */
function resolveLevel(flags: LoggingFlags, environment: Environment): LogLevel {
  if (flags.level != null) return flags.level;
  if (flags.quiet === true) return "warn";
  if (flags.verbose === true) return "debug";
  const fromEnvironment = parseLogLevel(environment["REVIEWER_LOG_LEVEL"]);
  if (fromEnvironment !== null) return fromEnvironment;
  return isTruthy(environment["RUNNER_DEBUG"]) || isTruthy(environment["ACTIONS_STEP_DEBUG"])
    ? "debug"
    : "info";
}

/** Whether the process is running as a step of a GitHub Actions job. */
function isGitHubRunner(environment: Environment): boolean {
  return isTruthy(environment["GITHUB_ACTIONS"]);
}

/** The line shape: what was asked for, or what the surroundings imply. */
function resolveFormat(flags: LoggingFlags, environment: Environment): LogFormat {
  const asked = flags.format ?? parseFormatName(environment["REVIEWER_LOG_FORMAT"]) ?? "auto";
  if (asked !== "auto") return asked;
  return isGitHubRunner(environment) ? "github" : "text";
}

/** A format name, however it was spelled, or `null` if it names no format. */
export function parseFormatName(value: string | undefined): LogFormatChoice | null {
  if (!isSet(value)) return null;
  const folded = value.trim().toLowerCase();
  return (LOG_FORMATS as readonly string[]).includes(folded) ? (folded as LogFormatChoice) : null;
}

/**
 * Whether the log lines may be coloured.
 *
 * Decided against the *log's* stream, not the program's output: piping
 * findings into another program says nothing about whether the person
 * watching the run can see colour (clig.dev, "Output"). `NO_COLOR` sits
 * above `FORCE_COLOR` because an accessibility preference should not be
 * overridable by a variable a build image happened to set; only the explicit
 * flag outranks it.
 *
 * `json` and `github` are never coloured: one is parsed, and the other is
 * coloured by the runner from the command itself.
 */
function shouldColor(
  flags: LoggingFlags,
  environment: Environment,
  format: LogFormat,
  isTTY: boolean,
): boolean {
  if (format !== "text") return false;
  if (flags.color != null) return flags.color;
  if (isSet(environment["NO_COLOR"])) return false;
  if (isTruthy(environment["FORCE_COLOR"]) || isTruthy(environment["CLICOLOR_FORCE"])) return true;
  return environment["TERM"] === "dumb" || environment["CLICOLOR"] === "0" ? false : isTTY;
}

/**
 * Environment variables whose *name* says they hold a credential.
 *
 * Matched on the name rather than the value: a key's shape is a guess that
 * over-masks (every hex string) and under-masks (the next provider's
 * format), while a name is what the operator themselves called it.
 */
const SECRET_NAME = /(?:API_?KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL)/iu;

/**
 * The shortest value worth masking.
 *
 * A two-character secret is not a secret, and masking it would redact every
 * innocent occurrence of those two characters -- including in file paths,
 * which is how redaction starts corrupting the logs it was added to protect.
 */
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
 * `text` with every known secret replaced by `***`.
 *
 * The replacement is a function rather than the string itself: a secret can
 * contain `$&`, and passing it as a literal would let `replaceAll` expand
 * that into the very text being masked.
 */
export function redact(text: string, secrets: readonly string[]): string {
  let result = text;
  for (const secret of secrets) result = result.replaceAll(secret, () => SECRET_MASK);
  return result;
}

export interface ResolveOptions {
  readonly environment?: Environment;
  /** Whether the log's own stream is a terminal; `false` when not stated. */
  readonly isTTY?: boolean;
}

/** Settle every logging question from the flags, the environment and the terminal. */
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
    color: shouldColor(flags, environment, format, options.isTTY ?? false),
    // The record around a message is detail, and `-v` is the request for
    // detail -- however that level was arrived at, including `RUNNER_DEBUG`.
    detailed: level === "debug",
    secrets: secretsFrom(environment),
  };
}
