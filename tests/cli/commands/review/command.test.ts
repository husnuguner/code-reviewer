/**
 * `reviewer review`: what the command line overrides, and when a run fails
 * the build.
 */

import { describe, expect, it } from "bun:test";

import { REVIEW } from "../../../../src/cli/commands/review/command";
import { cliOverrides, hasFailingFinding } from "../../../../src/cli/commands/review/run";
import { type BranchReviewResult } from "../../../../src/core/review/branch-review";
import { parsedBy } from "../../../helpers/command-line";

const review = parsedBy(REVIEW);

/** A run that reported one finding; only its severity matters to the gate. */
function reported(severity: string): Pick<BranchReviewResult, "findings"> {
  return {
    findings: [
      {
        path: "src/a.ts",
        line: 12,
        start_line: null,
        anchor: "exact",
        severity,
        body: "Null check missing.",
        example: "",
        skills: [],
      },
    ],
  };
}

describe("the --fail-on gate", () => {
  it("fails only on a severity --fail-on names", () => {
    expect(hasFailingFinding(reported("bug"), ["bug", "security"])).toBe(true);
    expect(hasFailingFinding(reported("readability"), ["bug", "security"])).toBe(false);
  });

  it("never fails without a gate, however severe the finding", () => {
    expect(hasFailingFinding(reported("bug"), [])).toBe(false);
    expect(hasFailingFinding({ findings: [] }, ["bug"])).toBe(false);
  });

  it("reads a reported severity however it was spelled", () => {
    // The same normalisation `--request-changes-on` applies: a build that
    // stopped failing because a record said `"Bug"` would be a gate that
    // fails open.
    for (const spelling of ["bug", "Bug", "BUG", " bug "]) {
      expect(hasFailingFinding(reported(spelling), ["bug"])).toBe(true);
    }
    expect(hasFailingFinding(reported("typo"), ["bug"])).toBe(false);
  });
});

describe("what the command line overrides", () => {
  it("only overrides what was actually passed", () => {
    expect(cliOverrides(review([]))).toEqual({});
    expect(cliOverrides(review(["--lang", "tr"]))).toEqual({ reviewLang: "tr" });
    // An empty skills path is a real instruction: it disables skills.
    expect(cliOverrides(review(["--skills-path", ""]))).toEqual({ skillsPath: "" });
    expect(cliOverrides(review(["--no-verify"]))).toEqual({ verifyFindings: false });
  });
});
