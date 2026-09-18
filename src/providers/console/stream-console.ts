/**
 * The console port over a writable stream: plain lines, stdout by default.
 *
 * Where a preview's file selection and a dry run's would-be report go. Not a
 * rendering of the review -- those are the formats under `reporting/` -- but
 * the place free-form text is printed when a command has something to say
 * that is not a record.
 */

import { type ConsoleOutput } from "../../core/ports/console";
import { type DryRunReporter, type PreviewReporter } from "../../core/ports/review-reporter";

export class StreamConsole implements ConsoleOutput, DryRunReporter, PreviewReporter {
  constructor(private readonly stream: NodeJS.WritableStream = process.stdout) {}

  line(text = ""): void {
    this.stream.write(`${text}\n`);
  }

  report(text: string): void {
    this.line(text);
  }
}
