/**
 * A `LineWriter` onto a stream.
 * @packageDocumentation
 */

import { type LineWriter } from "../../core/ports/review-reporter";

/** Writes each line to the stream with a trailing newline. */
export function lineWriter(stream: NodeJS.WritableStream): LineWriter {
  return (text) => {
    stream.write(`${text}\n`);
  };
}
