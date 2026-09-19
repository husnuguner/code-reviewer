/**
 * The plain-text output port: a command's result, for a human, on stdout.
 * @packageDocumentation
 */

/** Where a command prints its result. */
export interface ConsoleOutput {
  /** Writes one line; a trailing newline is added. */
  line(text?: string): void;
}
