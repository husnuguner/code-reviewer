/**
 * The console port over a writable stream: plain lines, stdout by default.
 * @packageDocumentation
 */

import { type ConsoleOutput } from "../../core/ports/console";
import { type DryRunReporter, type PreviewReporter } from "../../core/ports/review-reporter";

/** Prints free-form text for a command: a preview, a dry run's would-be report. */
export class StreamConsole implements ConsoleOutput, DryRunReporter, PreviewReporter {
  constructor(private readonly stream: NodeJS.WritableStream = process.stdout) {}

  line(text = ""): void {
    this.stream.write(`${text}\n`);
  }

  report(text: string): void {
    this.line(text);
  }
}
