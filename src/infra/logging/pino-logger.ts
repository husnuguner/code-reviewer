/**
 * The `Logger` port over pino, writing human-readable lines to stderr.
 *
 * stdout is reserved for the review's own output (NDJSON records must be the
 * only thing there), so every log line goes to stderr. pino keeps the records
 * structured underneath, which is what lets a different destination -- a
 * run log a UI reads, say -- be swapped in without touching the callers.
 *
 * Line shape mirrors the conventional `LEVEL name: message`; `--verbose` adds
 * a timestamp and lowers the threshold to DEBUG.
 */

import { Writable } from "node:stream";

import { type Logger as PinoInstance, pino } from "pino";

import { type Logger } from "../../core/ports/logger";

/** The root logger name every component name hangs under. */
export const ROOT_NAME = "reviewer";

export interface ConsoleLoggingOptions {
  readonly verbose?: boolean;
  /** Where the formatted lines go; defaults to `process.stderr`. */
  readonly sink?: NodeJS.WritableStream;
}

interface PinoRecord {
  readonly level?: unknown;
  readonly name?: unknown;
  readonly msg?: unknown;
  readonly time?: unknown;
}

/** `YYYY-MM-DD HH:MM:SS,mmm`, the conventional log timestamp. */
function stamp(epochMs: number): string {
  const iso = new Date(epochMs).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)},${iso.slice(20, 23)}`;
}

/** A record field as text, with a fallback for anything that is not a string. */
function field(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

/** One pino JSON line as `[timestamp ]LEVEL name: message`; non-JSON passes through. */
export function formatConsoleLine(line: string, isVerbose: boolean): string {
  let record: PinoRecord;
  try {
    record = JSON.parse(line) as PinoRecord;
  } catch {
    return `${line}\n`;
  }
  const level = field(record.level, "INFO");
  const name = field(record.name, ROOT_NAME);
  const message = field(record.msg, "");
  const prefix = isVerbose && typeof record.time === "number" ? `${stamp(record.time)} ` : "";
  return `${prefix}${level} ${name}: ${message}\n`;
}

/** Turns pino's JSON lines into `[timestamp ]LEVEL name: message` text. */
function consoleFormatStream(sink: NodeJS.WritableStream, isVerbose: boolean): Writable {
  return new Writable({
    write(chunk: Buffer | string, _encoding, callback): void {
      for (const line of chunk.toString().split("\n")) {
        if (line.trim() !== "") sink.write(formatConsoleLine(line, isVerbose));
      }
      callback();
    },
  });
}

/** A `Logger` bound to one pino instance (and one component name). */
export class PinoLogger implements Logger {
  constructor(private readonly pinoLogger: PinoInstance) {}

  /** The application's root logger, writing formatted lines to stderr. */
  static console(options: ConsoleLoggingOptions = {}): PinoLogger {
    const isVerbose = options.verbose ?? false;
    const destination = consoleFormatStream(options.sink ?? process.stderr, isVerbose);
    const root = pino(
      {
        name: ROOT_NAME,
        level: isVerbose ? "debug" : "info",
        base: null,
        timestamp: isVerbose ? pino.stdTimeFunctions.epochTime : false,
        formatters: {
          level: (label) => ({ level: label === "warn" ? "WARNING" : label.toUpperCase() }),
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
