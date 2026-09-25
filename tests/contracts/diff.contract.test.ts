import { describe, expect, it } from "bun:test";

import { type Elision, elideLines } from "../../src/core/diff/elision";
import { splitPatches } from "../../src/core/diff/patch-set";
import { addedLines, annotatePatch, newSideIndex, patchView } from "../../src/core/diff/patch-view";
import { type ChangedFileEntry } from "../../src/core/domain/changed-file";

import { casesUnder, loadFixture } from "./fixtures";

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

/** The view with regions left out: the same three answers, plus how many rows went. */
interface ElidedExpectation extends DiffExpectation {
  elided: number;
}

describe("the view with bypassed regions left out", () => {
  const elision = loadFixture("elision");

  it.each(
    casesUnder<{ patch: string; elide: Elision[] }, ElidedExpectation>(elision, "patch_view"),
  )("$name", ({ input, expected }) => {
    const view = patchView(input.patch, input.elide);
    expect([...view.addedLines].toSorted((a, b) => a - b)).toEqual(expected.added_lines);
    expect(view.newSide.map((entry) => [...entry])).toEqual(expected.new_side_index);
    expect(view.annotated).toBe(expected.annotate_patch);
    expect(view.elided).toBe(expected.elided);
  });

  it("is the plain view when nothing is elided", () => {
    const patch = "@@ -1,3 +1,4 @@\n a\n+b\n c\n d\n";
    expect(patchView(patch, [])).toEqual(patchView(patch));
    expect(patchView(patch).elided).toBe(0);
  });

  it.each(casesUnder<{ lines: string[]; elide: Elision[] }, string[]>(elision, "elide_lines"))(
    "file text: $name",
    ({ input, expected }) => {
      expect(elideLines(input.lines, input.elide)).toEqual(expected);
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
