/**
 * The clock the logs read their durations from.
 *
 * Small on purpose: what is pinned is the one rendering every timing line
 * shares (`42.3s`) and that a stopwatch reads the injected clock and not the
 * system's, so a test of a log line is the same on every machine.
 */

import { describe, expect, it } from "bun:test";

import { SYSTEM_CLOCK, describeUsage, seconds, stopwatch } from "../../../src/core/util/timing";

describe("seconds", () => {
  it("renders milliseconds as seconds with one decimal", () => {
    expect(seconds(0)).toBe("0.0s");
    expect(seconds(42_300)).toBe("42.3s");
    expect(seconds(999)).toBe("1.0s");
    expect(seconds(180_000)).toBe("180.0s");
  });

  it("never reports a negative wait", () => {
    // A clock that went backwards is the clock's problem, not the reader's.
    expect(seconds(-5)).toBe("0.0s");
  });
});

describe("describeUsage", () => {
  it("states both counts and the output rate", () => {
    expect(describeUsage({ inputTokens: 7036, outputTokens: 2410 }, 77_700)).toBe(
      "7,036 tokens in, 2,410 out, 31 tokens/s",
    );
  });

  it("says what a kept prefix saved, or cost, beside the input count", () => {
    // The one place a cache hit is visible: the answer and the wall time
    // look the same either way.
    const read = {
      inputTokens: 9445,
      outputTokens: 2455,
      cacheReadTokens: 7650,
      cacheWriteTokens: 0,
    };
    expect(describeUsage(read, 34_700)).toBe(
      "9,445 tokens in (7,650 cached), 2,455 out, 71 tokens/s",
    );
    const written = { ...read, cacheReadTokens: 0, cacheWriteTokens: 7650 };
    expect(describeUsage(written, 34_700)).toBe(
      "9,445 tokens in (7,650 cache written), 2,455 out, 71 tokens/s",
    );
    const both = { ...read, cacheReadTokens: 2014, cacheWriteTokens: 5636 };
    expect(describeUsage(both, 34_700)).toBe(
      "9,445 tokens in (2,014 cached, 5,636 cache written), 2,455 out, 71 tokens/s",
    );
  });

  it("reads as before for a vendor that kept nothing", () => {
    const none = { inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 };
    expect(describeUsage(none, 1000)).toBe("100 tokens in, 10 out, 10 tokens/s");
    const unknown = {
      inputTokens: 100,
      outputTokens: 10,
      cacheReadTokens: null,
      cacheWriteTokens: null,
    };
    expect(describeUsage(unknown, 1000)).toBe("100 tokens in, 10 out, 10 tokens/s");
  });

  it("leaves out what the vendor did not count", () => {
    expect(describeUsage({ inputTokens: 7036, outputTokens: null }, 1000)).toBe("7,036 tokens in");
    expect(describeUsage({ inputTokens: null, outputTokens: 500 }, 1000)).toBe(
      "500 out, 500 tokens/s",
    );
    expect(describeUsage({ inputTokens: null, outputTokens: null }, 1000)).toBe("");
  });

  it("says nothing at all without a usage, and no rate for a zero-length wait", () => {
    expect(describeUsage(undefined, 1000)).toBe("");
    expect(describeUsage({ inputTokens: 1, outputTokens: 2 }, 0)).toBe("1 tokens in, 2 out");
  });
});

describe("stopwatch", () => {
  it("reads the clock it was given, from the moment it was started", () => {
    let now = 1000;
    const elapsed = stopwatch(() => now);
    expect(elapsed()).toBe(0);
    now = 1250;
    expect(elapsed()).toBe(250);
    now = 5000;
    expect(elapsed()).toBe(4000);
  });

  it("defaults to a monotonic clock", () => {
    const elapsed = stopwatch();
    expect(elapsed()).toBeGreaterThanOrEqual(0);
    expect(typeof SYSTEM_CLOCK()).toBe("number");
  });
});
