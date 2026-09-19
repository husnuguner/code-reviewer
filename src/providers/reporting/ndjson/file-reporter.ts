/**
 * NDJSON into the `--out` file, owned end to end: opened eagerly so a bad path fails before any model
 * call, flushed on `close` so no record is left in a buffer.
 * @packageDocumentation
 */

import { createWriteStream, openSync } from "node:fs";
import { type Writable } from "node:stream";

import { type BranchReviewRecord } from "../../../core/ports/review-reporter";
import { ReportFileError, errorMessage } from "../../../core/util/errors";
import { type ClosableReporter } from "../closable";
import { lineWriter } from "../line-writer";

import { NdjsonReporter } from "./reporter";

/**
 * Opens and truncates the `--out` file synchronously.
 *
 * @throws {@link ReportFileError} when the path cannot be written.
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

/** Writes NDJSON records to a file stream and reports the first write failure on `close`. */
export class NdjsonFileReporter implements ClosableReporter {
  private readonly records: NdjsonReporter;
  private readonly stream: Writable;
  /** How the file is named in an error. */
  private readonly name: string;
  /** The first asynchronous write failure, kept for `close`. */
  private failure: Error | null = null;

  /**
   * @param stream - Taken rather than opened, so a test can drive the failure paths. Use {@link NdjsonFileReporter.open} for a run.
   */
  constructor(stream: Writable, name: string) {
    this.stream = stream;
    this.name = name;
    this.records = new NdjsonReporter(lineWriter(stream));
    this.stream.on("error", (error: Error) => {
      this.failure ??= error;
    });
  }

  /**
   * A reporter writing into `path`, truncating whatever was there.
   *
   * @throws {@link ReportFileError} when the path cannot be opened.
   */
  static open(path: string): NdjsonFileReporter {
    return new NdjsonFileReporter(createWriteStream(path, { fd: openRecordFile(path) }), path);
  }

  report(record: BranchReviewRecord): void {
    this.records.report(record);
  }

  /**
   * Flushes and closes the file.
   *
   * @throws {@link ReportFileError} when any write failed during the run.
   */
  async close(): Promise<void> {
    await this.flush();
    const failure = this.failure;
    if (failure !== null) {
      throw new ReportFileError(
        `--out file ${this.name} could not be written: ${errorMessage(failure)}`,
      );
    }
  }

  /** Waits for `finish` or `close`, whichever the stream reaches; a destroyed stream never emits `finish`. */
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
