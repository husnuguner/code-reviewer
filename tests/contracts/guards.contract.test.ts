/**
 * The two exclusions no configuration can undo. Half of these cases are the
 * negative half on purpose: a guard that also swallows `src/env.ts` would be
 * paid for in files nobody reviews, so where the list *stops* is as much the
 * contract as where it starts.
 */

import { describe, expect, it } from "vitest";

import { SECRET_PATHS, isBinaryPatch, isSecretPath } from "../../src/core/review/guards";

import { casesUnder, loadFixture } from "./fixtures";

const cases = loadFixture("guards");

describe("credential files", () => {
  it.each(casesUnder<{ path: string }, boolean>(cases, "secret"))(
    "$name",
    ({ input, expected }) => {
      expect(isSecretPath(input.path)).toBe(expected);
    },
  );

  it("states every pattern in lower case, since the path is lowered before matching", () => {
    expect(SECRET_PATHS.filter((glob) => glob !== glob.toLowerCase())).toEqual([]);
  });
});

describe("binary patches", () => {
  it.each(casesUnder<{ patch: string }, boolean>(cases, "binary"))(
    "$name",
    ({ input, expected }) => {
      expect(isBinaryPatch(input.patch)).toBe(expected);
    },
  );
});
