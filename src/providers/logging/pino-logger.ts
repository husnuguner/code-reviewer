/**
 * The `Logger` port over pino, writing to stderr. The record is always complete (UTC time, level,
 * component); a rendering decides how much a reader sees, and every rendering redacts at the sink.
 * @packageDocumentation
 */

import { Writable } from "node:stream";

import pc from "picocolors";
import { type Logger as PinoInstance, pino } from "pino";

import { type Logger } from "../../core/ports/logger";
import { escapeData } from "../../lib/github-actions/workflow-commands";

import { type LogSettings, SHORTEST_SECRET, redact, resolveLogSettings } from "./log-settings";

export {
  LOG_FORMATS,
  LOG_LEVELS,
  type LogFormat,
  type LogLevel,
  type LogSettings,
  type LoggingFlags,
  resolveLogSettings,
} from "./log-settings";

/** The root logger name every component hangs under. */
export const ROOT_NAME = "reviewer";

/** One log record, as pino writes it. */
export interface LogRecord {
  readonly level: string;
  readonly name: string;
  readonly msg: string;
  /** ISO-8601, or `undefined` when the record carries no time. */
  readonly time?: string;
}

/** A record field as text, with a fallback. */
function field(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

/** Parses one pino JSON line, or `null` when the line is not one. */
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

/** One record in, one line out (no newline). Chosen once when the logger is built. */
export type LogRendering = (record: LogRecord, settings: LogSettings) => string;

/** Unconditional painters: colour was already settled by `resolveLogSettings`, against stderr. */
const paint = pc.createColors(true);

/** How each level is coloured, when colour is on. */
const LEVEL_COLOR: Readonly<Record<string, (text: string) => string>> = {
  debug: paint.gray,
  info: paint.cyan,
  warn: paint.yellow,
  error: paint.red,
};

/** The level label: padded under `-v`, `level:` otherwise. */
function levelLabel(level: string, settings: LogSettings): string {
  const text = settings.detailed ? level.padEnd(5) : `${level}:`;
  if (!settings.color) return text;
  const colour = LEVEL_COLOR[level];
  return colour === undefined ? text : colour(text);
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

/**
 * The record's instant as a local wall clock: `14:32:07.412`.
 *
 * @returns Time of day with milliseconds; the input unchanged when it is not a parseable time.
 */
export function clockTime(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  const clock = `${pad(at.getHours(), 2)}:${pad(at.getMinutes(), 2)}:${pad(at.getSeconds(), 2)}`;
  return `${clock}.${pad(at.getMilliseconds(), 3)}`;
}

/** For a person: `warn: message`, or `HH:MM:SS.mmm  level  name: message` under `-v`. */
export const renderText: LogRendering = (record, settings) => {
  const label = levelLabel(record.level, settings);
  if (!settings.detailed) return `${label} ${record.msg}`;
  const dim = (text: string): string => (settings.color ? paint.dim(text) : text);
  const time = record.time === undefined ? "" : `${dim(clockTime(record.time))}  `;
  return `${time}${label}  ${dim(`${record.name}:`)} ${record.msg}`;
};

/** For a collector: the record as one JSON object. */
export const renderJson: LogRendering = (record) => JSON.stringify(record);

/**
 * For a GitHub runner: `debug` as `::debug::`, the rest as plain text.
 *
 * @remarks Only `debug` maps to a workflow command. `::warning::`/`::error::` would raise annotations and
 * a runner shows only ten per level per step; those slots belong to the findings.
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

/** One pino JSON line as the redacted, rendered text that reaches the sink, newline included. */
export function formatLine(
  line: string,
  settings: LogSettings,
  secrets: readonly string[] = settings.secrets,
): string {
  const safe = redact(line, secrets);
  const record = parseRecord(safe);
  // A line pino did not write is passed through rather than dropped.
  if (record === null) return `${safe}\n`;
  const render = RENDERINGS[settings.format] ?? renderText;
  return `${render(record, settings)}\n`;
}

/** Turns pino's JSON lines into whatever `settings.format` asked for, masking what `secrets` holds now. */
function formattingStream(
  sink: NodeJS.WritableStream,
  settings: LogSettings,
  secrets: SecretList,
): Writable {
  return new Writable({
    write(chunk: Buffer | string, _encoding, callback): void {
      for (const line of chunk.toString().split("\n")) {
        if (line.trim() !== "") sink.write(formatLine(line, settings, secrets.values));
      }
      callback();
    },
  });
}

/**
 * The values every line is masked for, shared by a root logger and its children. It grows: the model's key
 * is known only once the configuration is read, after the first lines are written.
 */
class SecretList {
  values: readonly string[];

  constructor(initial: readonly string[]) {
    this.values = initial;
  }

  add(value: string): void {
    if (value.length < SHORTEST_SECRET || this.values.includes(value)) return;
    this.values = [...this.values, value].toSorted((a, b) => b.length - a.length);
  }
}

/** Options for {@link PinoLogger.console}. */
export interface ConsoleLoggingOptions {
  /** Settled logging; resolved by the caller. */
  readonly settings?: LogSettings;
  /** Where the formatted lines go; default `process.stderr`. */
  readonly sink?: NodeJS.WritableStream;
}

/** A `Logger` bound to one pino instance and one component name. */
export class PinoLogger implements Logger {
  constructor(
    private readonly pinoLogger: PinoInstance,
    private readonly secrets: SecretList = new SecretList([]),
  ) {}

  /** The application's root logger, writing to stderr in the settled shape. `silent` is pino's own threshold. */
  static console(options: ConsoleLoggingOptions = {}): PinoLogger {
    const settings = options.settings ?? resolveLogSettings();
    const secrets = new SecretList(settings.secrets);
    const destination = formattingStream(options.sink ?? process.stderr, settings, secrets);
    const root = pino(
      {
        name: ROOT_NAME,
        level: settings.level,
        base: null,
        timestamp: pino.stdTimeFunctions.isoTime,
        formatters: {
          level: (label) => ({ level: label }),
        },
      },
      destination,
    );
    return new PinoLogger(root, secrets);
  }

  /**
   * Masks a value in every line from now on, this logger's family included: for a credential that came
   * from a file (a `.env`, a config file) rather than from a variable whose name says what it holds.
   */
  mask(value: string): void {
    this.secrets.add(value);
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

  /** A child named `reviewer.<name>`. */
  child(name: string): Logger {
    return new PinoLogger(this.pinoLogger.child({ name: `${ROOT_NAME}.${name}` }), this.secrets);
  }
}
