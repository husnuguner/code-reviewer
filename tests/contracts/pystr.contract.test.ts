import { describe, expect, it } from "vitest";

import { pySplit, pySplitlines, pyStrip, pyTitle } from "../../src/core/util/py";

import { casesUnder, loadFixture } from "./fixtures";

const cases = loadFixture<{ s: string }>("pystr");

describe("string primitives match the frozen semantics", () => {
  it.each(casesUnder<{ s: string }, string[]>(cases, "split"))(
    "split %s",
    ({ input, expected }) => {
      expect(pySplit(input.s)).toEqual(expected);
    },
  );

  it.each(casesUnder<{ s: string }, string[]>(cases, "splitlines"))(
    "splitlines %s",
    ({ input, expected }) => {
      expect(pySplitlines(input.s)).toEqual(expected);
    },
  );

  it.each(casesUnder<{ s: string }, string>(cases, "strip"))("strip %s", ({ input, expected }) => {
    expect(pyStrip(input.s)).toBe(expected);
  });

  it.each(casesUnder<{ s: string }, string>(cases, "title"))("title %s", ({ input, expected }) => {
    expect(pyTitle(input.s)).toBe(expected);
  });

  it.each(casesUnder<{ s: string }, string>(cases, "lower"))("lower %s", ({ input, expected }) => {
    expect(input.s.toLowerCase()).toBe(expected);
  });

  it.each(casesUnder<{ s: string }, string>(cases, "join_split"))(
    "join(split) %s",
    ({ input, expected }) => {
      expect(pySplit(input.s).join(" ")).toBe(expected);
    },
  );
});
