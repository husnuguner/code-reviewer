/**
 * A `reviewer: by-pass - <reason>` marker takes the block after it out of review. What counts as "the
 * block" -- braces, an indentation body, one statement, an else/catch chain -- is pinned here, case by
 * case, because a region that ends a line too early lets a finding through and one that runs a line
 * too far hides one.
 */

import { describe, expect, it } from "bun:test";

import { type BypassRegionRecord } from "../../src/core/ports/review-reporter";
import {
  type BypassRegion,
  bypassWarning,
  countBypassed,
  describeRegion,
  isWhollyBypassed,
  scanBypass,
} from "../../src/core/review/bypass";

import { casesUnder, loadFixture } from "./fixtures";

const bypass = loadFixture("bypass");

describe("scanning a file for bypass markers", () => {
  it.each(casesUnder<string[], { regions: BypassRegion[]; unreasoned: number[] }>(bypass, "scan"))(
    "$name",
    ({ input, expected }) => {
      expect(scanBypass(input)).toEqual(expected);
    },
  );

  it("reads a file of any size in one pass", () => {
    // A marker whose block never closes scans to the end; a hundred of them must not go quadratic.
    const lines = Array.from({ length: 50_000 }, (_, index) =>
      index % 500 === 0 ? "// reviewer: by-pass - perf" : "  a();",
    );
    const started = performance.now();
    const { regions } = scanBypass(lines);
    expect(performance.now() - started).toBeLessThan(2000);
    expect(regions).toHaveLength(100);
  });
});

describe("how many added lines the regions take", () => {
  it.each(
    casesUnder<{ lines: number[]; regions: BypassRegion[] }, number>(bypass, "count_bypassed"),
  )("$name", ({ input, expected }) => {
    expect(countBypassed(new Set(input.lines), input.regions)).toBe(expected);
  });
});

describe("whether a file has anything left to review", () => {
  it.each(
    casesUnder<{ lines: number[]; regions: BypassRegion[] }, boolean>(bypass, "wholly_bypassed"),
  )("$name", ({ input, expected }) => {
    expect(isWhollyBypassed(new Set(input.lines), input.regions)).toBe(expected);
  });
});

describe("how a region reads", () => {
  it.each(casesUnder<BypassRegionRecord, string>(bypass, "describe"))(
    "$name",
    ({ input, expected }) => {
      expect(describeRegion(input)).toBe(expected);
    },
  );

  it.each(casesUnder<BypassRegionRecord[], string>(bypass, "warning"))(
    "warning: $name",
    ({ input, expected }) => {
      expect(bypassWarning(input)).toBe(expected);
    },
  );
});
