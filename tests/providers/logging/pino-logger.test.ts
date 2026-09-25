/**
 * Log lines go to stderr in the shape the run settled on; stdout stays clean.
 *
 * The three renderings are checked through the logger rather than only as
 * functions, because what matters is that one call site reaches all three
 * unchanged: a `log.warn` is a `warn:` for a person, a `{"level":"warn"}`
 * for a collector and a `::warning::` for a runner, and no caller knows.
 */

import { describe, expect, it } from "bun:test";
import { PassThrough } from "node:stream";

import { type LogSettings, resolveLogSettings } from "../../../src/providers/logging/log-settings";
import {
  PinoLogger,
  clockTime,
  formatLine,
  parseRecord,
} from "../../../src/providers/logging/pino-logger";

function capture(): { sink: PassThrough; lines: () => string[] } {
  const sink = new PassThrough();
  let buffer = "";
  sink.on("data", (chunk: Buffer) => {
    buffer += chunk.toString();
  });
  return { sink, lines: () => buffer.split("\n").filter((line) => line !== "") };
}

/** Settings as a run would settle them, with the test's overrides on top. */
function settings(overrides: Partial<LogSettings> = {}): LogSettings {
  return { ...resolveLogSettings(), ...overrides };
}

/** The lines one logger wrote, for the given settings. */
function logged(
  overrides: Partial<LogSettings>,
  write: (log: ReturnType<PinoLogger["child"]>) => void,
): string[] {
  const { sink, lines } = capture();
  const log = PinoLogger.console({ sink, settings: settings(overrides) }).child("x");
  write(log);
  return lines();
}

describe("the default shape: a sentence, not a log record", () => {
  it("prefixes the level and nothing else", () => {
    // clig.dev: stderr is not a log file. The level stays because "this is a
    // warning" is part of the sentence; the timestamp and the component name
    // are plumbing, and `-v` is the request for plumbing.
    expect(
      logged({ level: "info", detailed: false, color: false }, (log) => {
        log.info("Loaded 3 skill(s)");
        log.warn("careful");
        log.error("boom");
      }),
    ).toEqual(["info: Loaded 3 skill(s)", "warn: careful", "error: boom"]);
  });

  it("honours the threshold, so debug costs nothing at INFO", () => {
    expect(
      logged({ level: "info", detailed: false, color: false }, (log) => {
        log.debug("hidden");
        log.info("shown");
      }),
    ).toEqual(["info: shown"]);
  });

  it("says nothing at all when the level is silent", () => {
    expect(
      logged({ level: "silent", color: false }, (log) => {
        log.info("x");
        log.error("even this");
      }),
    ).toEqual([]);
  });
});

describe("the verbose shape: the whole record", () => {
  it("adds a wall-clock timestamp and the component name", () => {
    const lines = logged({ level: "debug", detailed: true, color: false }, (log) =>
      log.debug("visible"),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\d{2}:\d{2}:\d{2}\.\d{3} {2}debug {2}reviewer\.x: visible$/u);
  });

  it("lines up the clock and the level as fixed-width columns", () => {
    // The two columns are what an eye scans down; a level of a different
    // length must not shift the component name out from under the one above.
    const lines = logged({ level: "debug", detailed: true, color: false }, (log) => {
      log.debug("d");
      log.info("i");
      log.error("e");
    });
    const offsets = lines.map((line) => line.indexOf("reviewer.x:"));
    expect(new Set(offsets).size).toBe(1);
  });

  it("names children under the root, as Python's module loggers are", () => {
    const { sink, lines } = capture();
    PinoLogger.console({
      sink,
      settings: settings({ level: "debug", detailed: true, color: false }),
    })
      .child("review.changed_file")
      .info("review a.ts: +1 line(s)");
    expect(lines()[0]).toContain("reviewer.review.changed_file: review a.ts: +1 line(s)");
  });
});

describe("the clock a verbose line shows", () => {
  it("is the reader's own, because they are matching a line against what they just did", () => {
    // The record stays UTC (that is what two machines can compare); the
    // rendering is local, and this pins the conversion rather than the
    // shape -- the assertion has to hold in whatever zone CI runs in.
    const at = new Date(2025, 8, 18, 14, 32, 7, 412);
    expect(clockTime(at.toISOString())).toBe("14:32:07.412");
  });

  it("pads every field, so the column cannot narrow at one past midnight", () => {
    const at = new Date(2025, 0, 1, 0, 1, 2, 3);
    expect(clockTime(at.toISOString())).toBe("00:01:02.003");
  });

  it("passes through a time it cannot read rather than inventing one", () => {
    expect(clockTime("not a time")).toBe("not a time");
  });
});

describe("--log-format json", () => {
  it("emits one complete record per line, whatever the level", () => {
    const lines = logged({ level: "debug", format: "json", color: false }, (log) => {
      log.debug("d");
      log.warn("w");
    });
    const records = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(records).toMatchObject([
      { level: "debug", name: "reviewer.x", msg: "d" },
      { level: "warn", name: "reviewer.x", msg: "w" },
    ]);
    // The time is in the record even though the text rendering hides it,
    // and it stays full UTC ISO-8601 there whatever the text column shows:
    // a record is either complete or it is not.
    expect(records[0]?.["time"]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u);
  });
});

describe("--log-format github", () => {
  it("hands debug to the runner, which already hides it behind the same switch", () => {
    expect(
      logged({ level: "debug", detailed: false, format: "github" }, (log) => log.debug("d")),
    ).toEqual(["::debug::d"]);
  });

  it("escapes a newline, which would otherwise truncate the message silently", () => {
    expect(
      logged({ level: "debug", format: "github" }, (log) => log.debug("line one\nline two")),
    ).toEqual(["::debug::line one%0Aline two"]);
  });

  it("leaves every annotation slot to the findings, which is what they are for", () => {
    // A runner shows ten annotations per level per step, and the findings
    // are annotations (`--format github`). A `::warning::` about a missing
    // merge-base would not merely add noise -- it would silently evict a
    // finding the operator paid a model to produce. So process detail
    // prints as text and the report keeps the budget.
    const lines = logged({ level: "info", detailed: false, format: "github" }, (log) => {
      log.info("i");
      log.warn("w");
      log.error("e");
    });
    expect(lines).toEqual(["info: i", "warn: w", "error: e"]);
    expect(lines.join("\n")).not.toContain("::");
  });

  it("never colours, because the runner is not the thing reading it", () => {
    const [line] = logged(
      { level: "info", detailed: false, format: "github", color: true },
      (log) => log.error("boom"),
    );
    expect(line).toBe("error: boom");
  });
});

describe("colour", () => {
  it("is applied to the level when the run settled on colour", () => {
    const [line] = logged({ level: "info", detailed: false, color: true }, (log) =>
      log.error("boom"),
    );
    // eslint-disable-next-line no-control-regex -- an ANSI escape is the assertion
    expect(line).toMatch(/\u{1B}\[/u);
    expect(line).toContain("boom");
  });

  it("is absent otherwise, so a redirected stream holds no escape codes", () => {
    const [line] = logged({ level: "info", detailed: false, color: false }, (log) =>
      log.error("boom"),
    );
    expect(line).toBe("error: boom");
  });
});

describe("redaction", () => {
  it("masks a secret at the sink, so no call site has to remember", () => {
    expect(
      logged({ level: "info", color: false, secrets: ["sk-secret-value"] }, (log) =>
        log.error("auth failed: sk-secret-value"),
      ),
    ).toEqual(["error: auth failed: ***"]);
  });

  it("masks a value it is told of later, in every logger of the family, from then on", async () => {
    // The model's key is known once the configuration is read: from a `.env` or a config file, where
    // no variable name marks it as a secret.
    const { sink, lines } = capture();
    const root = PinoLogger.console({ sink, settings: settings({ level: "info", color: false }) });
    const child = root.child("x");
    child.info("key sk-from-a-dotenv-file");
    root.mask("sk-from-a-dotenv-file");
    root.mask("short");
    child.info("key sk-from-a-dotenv-file, and short");
    await new Promise((resolve) => setImmediate(resolve));
    expect(lines()).toEqual(["info: key sk-from-a-dotenv-file", "info: key ***, and short"]);
  });

  it("masks in every rendering, including the one a collector parses", () => {
    const [line] = logged({ level: "info", format: "json", secrets: ["sk-secret-value"] }, (log) =>
      log.error("auth failed: sk-secret-value"),
    );
    expect(line).not.toContain("sk-secret-value");
    expect(JSON.parse(line ?? "")).toMatchObject({ msg: "auth failed: ***" });
  });
});

describe("a line pino did not write", () => {
  it("passes through rather than vanishing, because losing it would hide the bug", () => {
    expect(formatLine("plain text", settings({ color: false }))).toBe("plain text\n");
    expect(parseRecord("plain text")).toBeNull();
    expect(parseRecord("null")).toBeNull();
  });
});
