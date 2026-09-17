import { describe, expect, it } from "vitest";

import { type ChangedFileEntry } from "../../src/core/domain/changed-file";
import { addedLines, annotatePatch, newSideIndex } from "../../src/core/review/diff";
import { splitPatches } from "../../src/core/review/patch-set";

import { loadFixture } from "./fixtures";

interface DiffExpectation {
  added_lines: number[];
  new_side_index: [number, string][];
  annotate_patch: string;
}

describe("per-file patch helpers", () => {
  it.each(loadFixture<{ patch: string }, DiffExpectation>("diff"))(
    "$name",
    ({ input, expected }) => {
      expect([...addedLines(input.patch)].toSorted((a, b) => a - b)).toEqual(expected.added_lines);
      expect(newSideIndex(input.patch).map((entry) => [...entry])).toEqual(expected.new_side_index);
      expect(annotatePatch(input.patch)).toBe(expected.annotate_patch);
    },
  );
});

describe("splitting a git diff into provider-shaped entries", () => {
  it.each(loadFixture<{ raw: string }, ChangedFileEntry[]>("local_git"))(
    "$name",
    ({ input, expected }) => {
      expect(splitPatches(input.raw)).toEqual(expected);
    },
  );
});
