/**
 * A `LineWriter` onto a stream: the one thing every rendering here writes
 * through, named once so a format takes a function rather than a stream.
 */

import { type LineWriter } from "../../core/ports/review-reporter";

export function lineWriter(stream: NodeJS.WritableStream): LineWriter {
  return (text) => {
    stream.write(`${text}\n`);
  };
}
