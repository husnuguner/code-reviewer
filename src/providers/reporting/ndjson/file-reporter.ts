/**
 * NDJSON into the file `--out` names, owned by the run from end to end.
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

import { createWriteStream, openSync } from "node:fs";
import { type Writable } from "node:stream";

import { type BranchReviewRecord } from "../../../core/ports/review-reporter";
import { ReportFileError, errorMessage } from "../../../core/util/errors";
import { type ClosableReporter } from "../closable";
import { lineWriter } from "../line-writer";

import { NdjsonReporter } from "./reporter";

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
