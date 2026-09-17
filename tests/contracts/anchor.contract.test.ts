import { describe, expect, it } from "vitest";

import { resolveAnchor } from "../../src/core/review/anchor";
import { addedLines, newSideIndex } from "../../src/core/review/diff";

import { loadFixture } from "./fixtures";

interface AnchorInput {
  patch: string;
  line: unknown;
  existing_code: string;
  empty_index: boolean;
}

interface AnchorExpectation {
  line: number | null;
  start_line: number | null;
  outcome: string;
}

describe("anchoring a finding from its line and its quote", () => {
  it.each(loadFixture<AnchorInput, AnchorExpectation>("anchor"))("$name", ({ input, expected }) => {
    const anchor = resolveAnchor({
      line: input.line,
      existingCode: input.existing_code,
      index: input.empty_index ? [] : newSideIndex(input.patch),
      allowed: addedLines(input.patch),
    });
    expect({ line: anchor.line, start_line: anchor.startLine, outcome: anchor.outcome }).toEqual(
      expected,
    );
  });
});
