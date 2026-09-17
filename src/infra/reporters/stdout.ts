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

import { createWriteStream } from "node:fs";

import { type ConsoleOutput } from "../../core/ports/console";
import {
  type BranchReviewRecord,
  type BranchReviewReporter,
  type DryRunReporter,
  type PreviewReporter,
} from "../../core/ports/review-reporter";
import { type LineWriter } from "../../core/reporting/format-registry";

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

  /**
   * The same records into a file, truncating whatever was there.
   *
   * Truncating rather than appending: a run's output is the whole answer for
   * that run, and a file that accumulated two runs would describe a change
   * set that never existed.
   */
  static toFile(path: string): NdjsonReporter {
    return new NdjsonReporter(lineWriter(createWriteStream(path, { flags: "w" })));
  }

  report(record: BranchReviewRecord): void {
    this.write(JSON.stringify(record));
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
export class TeeReporter implements BranchReviewReporter {
  constructor(private readonly reporters: readonly BranchReviewReporter[]) {}

  report(record: BranchReviewRecord): void {
    for (const reporter of this.reporters) reporter.report(record);
  }
}
