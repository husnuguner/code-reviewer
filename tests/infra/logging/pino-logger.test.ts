/**
 * Log lines go to stderr as `LEVEL name: message`; stdout stays clean.
 */

import { describe, expect, it } from "bun:test";
import { PassThrough } from "node:stream";

import { PinoLogger, formatConsoleLine } from "../../../src/infra/logging/pino-logger";

function capture(): { sink: PassThrough; lines: () => string[] } {
  const sink = new PassThrough();
  let buffer = "";
  sink.on("data", (chunk: Buffer) => {
    buffer += chunk.toString();
  });
  return { sink, lines: () => buffer.split("\n").filter((line) => line !== "") };
}

describe("console log formatting", () => {
  it("renders LEVEL name: message", () => {
    expect(
      formatConsoleLine(JSON.stringify({ level: "INFO", name: "reviewer.x", msg: "hello" }), false),
    ).toBe("INFO reviewer.x: hello\n");
  });

  it("prefixes a timestamp when verbose", () => {
    const line = formatConsoleLine(
      JSON.stringify({
        level: "DEBUG",
        name: "reviewer.x",
        msg: "m",
        time: Date.UTC(2026, 8, 16, 14, 3, 15, 123),
      }),
      true,
    );
    expect(line).toBe("2026-09-16 14:03:15,123 DEBUG reviewer.x: m\n");
  });

  it("passes non-JSON through untouched", () => {
    expect(formatConsoleLine("plain text", false)).toBe("plain text\n");
  });
});

describe("the pino-backed logger", () => {
  it("names children under the root and honours the default INFO threshold", () => {
    const { sink, lines } = capture();
    const root = PinoLogger.console({ sink });
    const log = root.child("review.changed_file");
    log.debug("hidden");
    log.info("review a.ts: +1 line(s)");
    log.warn("careful");
    log.error("boom");
    expect(lines()).toEqual([
      "INFO reviewer.review.changed_file: review a.ts: +1 line(s)",
      "WARNING reviewer.review.changed_file: careful",
      "ERROR reviewer.review.changed_file: boom",
    ]);
  });

  it("shows DEBUG with a timestamp when verbose", () => {
    const { sink, lines } = capture();
    PinoLogger.console({ sink, verbose: true }).child("x").debug("visible");
    expect(lines()).toHaveLength(1);
    expect(lines()[0]).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2},\d{3} DEBUG reviewer\.x: visible$/u,
    );
  });
});
