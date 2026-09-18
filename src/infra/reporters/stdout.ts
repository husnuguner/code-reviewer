/**
 * Stream adapters for the output ports.
 *
 * NDJSON writes one JSON record per line and flushes each line immediately,
 * so a caller reading stdout line-by-line can parse each record as it
 * arrives. Logs never come here: they go to stderr through the logger.
 *
 * NDJSON is also the machine contract this tool ends at. It reports; whatever
 * turns a finding into a pull-request comment (a CI bot, a dashboard) reads
 * these records, which is why the file sink exists at all.
 */

import { createWriteStream, openSync } from "node:fs";
import { type Writable } from "node:stream";

import { type ConsoleOutput } from "../../core/ports/console";
import {
  type BranchReviewRecord,
  type BranchReviewReporter,
  type DryRunReporter,
  type PreviewReporter,
} from "../../core/ports/review-reporter";
import { type LineWriter } from "../../core/reporting/format-registry";
import { ReportFileError, errorMessage } from "../../core/util/errors";

/**
 * A reporter holding something the operating system lent it for the length of
 * the run, and which the run must therefore hand back.
 *
 * Only the `--out` file sink owns anything; every other rendering writes to a
 * stream it did not open. So this is an extra capability rather than part of
 * the output port: a format that owns nothing must not have to pretend it
 * does, and `closeReporter` asks the question of whatever the composition
 * root happened to build.
 */
export interface ClosableReporter extends BranchReviewReporter {
  /** Flush every record already reported and release the resource. */
  close(): Promise<void>;
}

function isClosableReporter(reporter: BranchReviewReporter): reporter is ClosableReporter {
  return "close" in reporter && typeof reporter.close === "function";
}

/**
 * Hand back whatever the reporter borrowed, and report a write that failed.
 *
 * Asked of the reporter the container built, whatever it turned out to be: a
 * rendering that owns nothing answers by doing nothing, so the caller does
 * not have to know which one it got.
 */
export async function closeReporter(reporter: BranchReviewReporter): Promise<void> {
  if (isClosableReporter(reporter)) await reporter.close();
}

/** A `LineWriter` onto a stream, which is what every sink here is built from. */
export function lineWriter(stream: NodeJS.WritableStream): LineWriter {
  return (text) => {
    stream.write(`${text}\n`);
  };
}

/** Plain lines on a writable stream (stdout by default). */
export class StreamConsole implements ConsoleOutput, DryRunReporter, PreviewReporter {
  constructor(private readonly stream: NodeJS.WritableStream = process.stdout) {}

  line(text = ""): void {
    this.stream.write(`${text}\n`);
  }

  report(text: string): void {
    this.line(text);
  }
}

/** One JSON record per line, written through as soon as it is produced. */
export class NdjsonReporter implements BranchReviewReporter {
  constructor(private readonly write: LineWriter) {}

  report(record: BranchReviewRecord): void {
    this.write(JSON.stringify(record));
  }
}

/**
 * The file `--out` names, open and truncated, or the operator's error.
 *
 * Synchronous and eager on purpose. A write stream reports a path it cannot
 * open as an asynchronous `error` event, which -- with no listener -- takes
 * the process down with a stack trace from Node's internals, and does so only
 * once records begin to flow: after every model call has been paid for, so the
 * run's findings are lost along with it. Opening here turns the same mistake
 * into a throw the caller can make before the review starts.
 *
 * Truncating rather than appending: a run's output is the whole answer for
 * that run, and a file that accumulated two runs would describe a change set
 * that never existed.
 */
function openRecordFile(path: string): number {
  try {
    return openSync(path, "w");
  } catch (error) {
    throw new ReportFileError(
      `--out names ${path}, which cannot be written: ${errorMessage(error)}`,
    );
  }
}

/**
 * NDJSON into a file the run owns from end to end.
 *
 * The stream is only ever reached through this class, so the two ways writing
 * to a file goes wrong are answered in one place:
 *
 * - **Before the run.** `open` fails loudly at construction (see
 *   `openRecordFile`), which is what makes a bad `--out` cost nothing.
 * - **During it.** A disk that fills mid-run can only fail asynchronously, so
 *   the first such reason is kept and stated by `close`. The listener is the
 *   point: an `error` event nobody is listening for is an uncaught exception,
 *   whatever else is true.
 *
 * `close` also waits for the flush rather than trusting the process to exit
 * at a convenient moment -- a record still in a buffer is a record the CI bot
 * downstream never reads.
 */
export class NdjsonFileReporter implements ClosableReporter {
  private readonly records: NdjsonReporter;
  private readonly stream: Writable;
  /** How the file is named in an error; the path, or a test's stand-in. */
  private readonly name: string;
  /** The first asynchronous write failure, kept for `close` to report. */
  private failure: Error | null = null;

  /**
   * Takes the stream rather than opening one, so a test can drive the failure
   * paths (a write that fails, a stream that is already gone) without a full
   * disk to hand. `open` is how a run gets one.
   */
  constructor(stream: Writable, name: string) {
    this.stream = stream;
    this.name = name;
    this.records = new NdjsonReporter(lineWriter(stream));
    this.stream.on("error", (error: Error) => {
      this.failure ??= error;
    });
  }

  /** The records into `path`, truncating whatever was there. */
  static open(path: string): NdjsonFileReporter {
    return new NdjsonFileReporter(createWriteStream(path, { fd: openRecordFile(path) }), path);
  }

  report(record: BranchReviewRecord): void {
    this.records.report(record);
  }

  async close(): Promise<void> {
    await this.flush();
    const failure = this.failure;
    if (failure !== null) {
      throw new ReportFileError(
        `--out file ${this.name} could not be written: ${errorMessage(failure)}`,
      );
    }
  }

  /**
   * Wait for the stream to finish with the lines it was given.
   *
   * `finish` is the ordinary end and `close` the one a failed stream reaches
   * instead, so both are awaited: waiting for `finish` alone would hang a run
   * whose stream had already been destroyed by an error, which is precisely
   * the case this whole class exists for.
   */
  private async flush(): Promise<void> {
    if (this.stream.destroyed) return;
    await new Promise<void>((resolve) => {
      const done = (): void => {
        resolve();
      };
      this.stream.once("close", done);
      this.stream.end(done);
    });
  }
}

/**
 * One record to several reporters, in order.
 *
 * What makes `--out` orthogonal to `--format`: a CI run wants annotations on
 * the diff *and* a machine-readable copy for whatever posts the comments, and
 * a model call is far too expensive to make twice for two renderings of one
 * answer.
 */
export class TeeReporter implements ClosableReporter {
  constructor(private readonly reporters: readonly BranchReviewReporter[]) {}

  report(record: BranchReviewRecord): void {
    for (const reporter of this.reporters) reporter.report(record);
  }

  /**
   * Close the members that own something, in order.
   *
   * A member whose close fails stops the walk, which is the honest reading:
   * at most one of these owns a file, and its failure is the one worth
   * reporting rather than swallowing to reach the renderings that cannot fail.
   */
  async close(): Promise<void> {
    for (const reporter of this.reporters) await closeReporter(reporter);
  }
}
