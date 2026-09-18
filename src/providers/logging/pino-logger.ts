/**
 * The `Logger` port over pino, writing to stderr in whichever shape the run
 * asked for.
 *
 * stdout is reserved for the review's own output (NDJSON records must be the
 * only thing there), so every log line goes to stderr. pino keeps the records
 * structured underneath, which is what lets one run print `warn: ...` for a
 * person, the next emit JSON for a log collector, and a third emit
 * `::warning::` for a GitHub runner -- from the same call sites, with no
 * caller aware of the difference.
 *
 * The structured record is always complete (ISO-8601 time, level name,
 * component name); a *rendering* decides how much of it a reader sees. That
 * ordering matters: `--log-format json` must not be a second, lossy
 * formatting path, it must be the same record with nothing thrown away.
 *
 * A *reader's* clock is not a collector's. The record carries UTC ISO-8601
 * because that is the one instant two machines can compare, and the text
 * rendering prints it as a local wall-clock time, because the person under
 * `-v` is matching a line against what they just did, not against another
 * host's log.
 *
 * Every rendering redacts. Redaction sits at the sink rather than at the call
 * sites because a call site that has to remember is a call site that will
 * eventually forget, and the cost of forgetting is a credential in a CI log
 * that is world-readable and cannot be recalled.
 */

import { Writable } from "node:stream";

import pc from "picocolors";
import { type Logger as PinoInstance, pino } from "pino";

import { type Logger } from "../../core/ports/logger";
import { escapeData } from "../../lib/github-actions/workflow-commands";

import { type LogSettings, redact, resolveLogSettings } from "./log-settings";

export {
  LOG_FORMATS,
  LOG_LEVELS,
  type LogFormat,
  type LogLevel,
  type LogSettings,
  type LoggingFlags,
  parseFormatName,
  parseLogLevel,
  resolveLogSettings,
} from "./log-settings";

/** The root logger name every component name hangs under. */
export const ROOT_NAME = "reviewer";

/** One log record, as pino writes it and a rendering reads it back. */
export interface LogRecord {
  readonly level: string;
  readonly name: string;
  readonly msg: string;
  /** ISO-8601, or `undefined` when the record carries no time. */
  readonly time?: string;
}

/** A record field as text, with a fallback for anything that is not a string. */
function field(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

/** One pino JSON line as a record, or `null` when the line is not one. */
export function parseRecord(line: string): LogRecord | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  const time = record["time"];
  return {
    level: field(record["level"], "info"),
    name: field(record["name"], ROOT_NAME),
    msg: field(record["msg"], ""),
    ...(typeof time === "string" && { time }),
  };
}

// -- renderings ---------------------------------------------------------------
//
// One record in, one line out (without its newline). A rendering is chosen
// once, when the logger is built, and never branched on afterwards.

export type LogRendering = (record: LogRecord, settings: LogSettings) => string;

/**
 * Painters that always paint.
 *
 * picocolors decides for itself whether colour is supported, and decides it
 * from `process.stdout`. Both halves are wrong here: the logs go to stderr,
 * and whether they may be coloured was already settled -- against stderr,
 * `NO_COLOR`, `FORCE_COLOR` and the flag -- by `resolveLogSettings`. So the
 * library is asked for unconditional painters and `settings.color` remains
 * the only switch, which is what keeps one decision in one place.
 */
const paint = pc.createColors(true);

/** How each level is coloured, when colour is on at all. */
const LEVEL_COLOR: Readonly<Record<string, (text: string) => string>> = {
  debug: paint.gray,
  info: paint.cyan,
  warn: paint.yellow,
  error: paint.red,
};

/** The level as it is written, padded so the messages of a verbose run line up. */
function levelLabel(level: string, settings: LogSettings): string {
  const text = settings.detailed ? level.padEnd(5) : `${level}:`;
  if (!settings.color) return text;
  const colour = LEVEL_COLOR[level];
  return colour === undefined ? text : colour(text);
}

/** A number as a fixed-width field, so every line's clock is the same width. */
function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

/**
 * The record's instant as a local wall clock: `14:32:07.412`.
 *
 * Time of day rather than a date, because a run is minutes long and the
 * date is the same on every line of it -- a column that never varies is a
 * column that only pushes the sentence rightwards. Milliseconds stay: they
 * are the reason to read a timestamp in a verbose run at all, where the
 * gap between two lines is how a slow model call announces itself.
 *
 * Anything that is not a time pino wrote is returned as-is rather than
 * dropped or guessed at, on the same principle as an unparseable line.
 */
export function clockTime(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  const clock = `${pad(at.getHours(), 2)}:${pad(at.getMinutes(), 2)}:${pad(at.getSeconds(), 2)}`;
  return `${clock}.${pad(at.getMilliseconds(), 3)}`;
}

/**
 * For a person: `warn: message`, or the whole record under `-v`.
 *
 * The bare form is the one clig.dev argues for -- stderr is not a log file,
 * and a reader who did not ask for the plumbing should not have to read
 * past a timestamp and a component name to reach the sentence. The level
 * stays, because "this is a warning" is part of the sentence; the rest is
 * what `-v` turns on.
 */
export const renderText: LogRendering = (record, settings) => {
  const label = levelLabel(record.level, settings);
  if (!settings.detailed) return `${label} ${record.msg}`;
  const dim = (text: string): string => (settings.color ? paint.dim(text) : text);
  // Two spaces, not one: the clock and the level are fixed-width columns,
  // and a wider gutter is what lets an eye scan down one of them past a
  // message that ran long.
  const time = record.time === undefined ? "" : `${dim(clockTime(record.time))}  `;
  return `${time}${label}  ${dim(`${record.name}:`)} ${record.msg}`;
};

/** For a collector: the record itself, one JSON object per line. */
export const renderJson: LogRendering = (record) => JSON.stringify(record);

/**
 * For a GitHub runner: `debug` as a workflow command, the rest as plain
 * text.
 *
 * Only `debug` maps across, and the asymmetry is the whole point.
 * `::debug::` raises no annotation -- the runner simply hides the line
 * unless the job was re-run with debug logging, which is exactly the
 * threshold `-v` means, so the two notions of "debug" are already the same
 * notion and the runner is a better place to keep it than a flag.
 *
 * `::notice::`, `::warning::` and `::error::` are a different kind of
 * thing: each raises an annotation, and a runner shows **only ten
 * annotations per level per step** (actions/toolkit, "Problem Matchers --
 * Limitations"). Those ten are already spoken for. A run's *findings* are
 * annotations -- that is what `--format github` is for, and what puts a
 * finding beside the code it is about -- so a warning about a missing
 * merge-base, emitted as `::warning::`, does not merely add noise: it
 * silently evicts a finding the operator paid a model to produce.
 *
 * Process detail must not outbid the product. So a warning prints as
 * `warn: ...` here exactly as it does for a person, staying in the log
 * where it belongs and leaving every annotation slot to the report.
 */
export const renderGitHub: LogRendering = (record, settings) =>
  record.level === "debug"
    ? `::debug::${escapeData(record.msg)}`
    : renderText(record, { ...settings, color: false });

const RENDERINGS: Readonly<Record<string, LogRendering>> = {
  text: renderText,
  json: renderJson,
  github: renderGitHub,
};

/** One pino JSON line as the text that reaches the sink, newline included. */
export function formatLine(line: string, settings: LogSettings): string {
  const safe = redact(line, settings.secrets);
  const record = parseRecord(safe);
  // A line pino did not write (a stray `console.log` into the stream, say)
  // is passed through rather than dropped: losing it would hide the bug.
  if (record === null) return `${safe}\n`;
  const render = RENDERINGS[settings.format] ?? renderText;
  return `${render(record, settings)}\n`;
}

/** Turns pino's JSON lines into whatever `settings.format` asked for. */
function formattingStream(sink: NodeJS.WritableStream, settings: LogSettings): Writable {
  return new Writable({
    write(chunk: Buffer | string, _encoding, callback): void {
      for (const line of chunk.toString().split("\n")) {
        if (line.trim() !== "") sink.write(formatLine(line, settings));
      }
      callback();
    },
  });
}

export interface ConsoleLoggingOptions {
  /** Settled logging; resolved from flags and the environment by the caller. */
  readonly settings?: LogSettings;
  /** Where the formatted lines go; defaults to `process.stderr`. */
  readonly sink?: NodeJS.WritableStream;
}

/** A `Logger` bound to one pino instance (and one component name). */
export class PinoLogger implements Logger {
  constructor(private readonly pinoLogger: PinoInstance) {}

  /**
   * The application's root logger, writing to stderr in the settled shape.
   *
   * `silent` is honoured by pino's own threshold rather than by a null
   * logger, so `-q -q` costs a comparison per call and nothing else --
   * including no string building at the call site pino never reaches.
   */
  static console(options: ConsoleLoggingOptions = {}): PinoLogger {
    const settings = options.settings ?? resolveLogSettings();
    const destination = formattingStream(options.sink ?? process.stderr, settings);
    const root = pino(
      {
        name: ROOT_NAME,
        level: settings.level,
        base: null,
        // ISO-8601 always, whatever the rendering: a record is either
        // complete or it is not, and `text` drops the time at the sink.
        timestamp: pino.stdTimeFunctions.isoTime,
        formatters: {
          level: (label) => ({ level: label }),
        },
      },
      destination,
    );
    return new PinoLogger(root);
  }

  debug(message: string): void {
    this.pinoLogger.debug(message);
  }

  info(message: string): void {
    this.pinoLogger.info(message);
  }

  warn(message: string): void {
    this.pinoLogger.warn(message);
  }

  error(message: string): void {
    this.pinoLogger.error(message);
  }

  /** A child named `reviewer.<name>`, as Python's module loggers are. */
  child(name: string): Logger {
    return new PinoLogger(this.pinoLogger.child({ name: `${ROOT_NAME}.${name}` }));
  }
}
