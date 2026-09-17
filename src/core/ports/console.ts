/**
 * The plain-text output port: what a command prints for a human to read.
 *
 * Separate from logging on purpose. Log lines describe what the run is doing
 * and go to stderr; console output *is* the result of a command (`projects`,
 * `init`, a text review) and goes to stdout. A UI substitutes its own sink.
 */

export interface ConsoleOutput {
  /** Write one line (a trailing newline is added). */
  line(text?: string): void;
}
