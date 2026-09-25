/**
 * `reviewer review`: what the command line overrides, and when a run fails
 * the build.
 */

import { describe, expect, it } from "bun:test";

import { OperatorError } from "../../../../src/cli/command-line";
import { REVIEW } from "../../../../src/cli/commands/review/command";
import {
  FINDINGS_EXIT_CODE,
  INCOMPLETE_EXIT_CODE,
  cliOverrides,
  exitCodeFor,
  hasFailingFinding,
  resolveBase,
} from "../../../../src/cli/commands/review/run";
import { NULL_LOGGER } from "../../../../src/core/ports/logger";
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

describe("the exit code", () => {
  it("is 4 when a selected file could not be reviewed, whatever else the run found", () => {
    // An unanswered file is not a clean one: a gate that passed on a run whose model was down
    // would be a gate that fails open.
    expect(exitCodeFor({ findings: [], failed: 1 }, [])).toBe(INCOMPLETE_EXIT_CODE);
    expect(exitCodeFor({ ...reported("bug"), failed: 1 }, ["bug"])).toBe(INCOMPLETE_EXIT_CODE);
  });

  it("is 3 for a gated finding on a complete run, and 0 otherwise", () => {
    expect(exitCodeFor({ ...reported("bug"), failed: 0 }, ["bug"])).toBe(FINDINGS_EXIT_CODE);
    expect(exitCodeFor({ ...reported("bug"), failed: 0 }, [])).toBe(0);
    expect(exitCodeFor({ findings: [], failed: 0 }, ["bug"])).toBe(0);
  });
});

describe("the base a run compares against", () => {
  const found = { defaultBase: (): Promise<string | null> => Promise.resolve("origin/main") };
  const none = { defaultBase: (): Promise<string | null> => Promise.resolve(null) };
  const scope = { base: null, uncommitted: false, since: null };

  it("is --base when named, and the repository's default branch when not", async () => {
    expect(await resolveBase({ ...scope, base: "develop" }, found, NULL_LOGGER)).toBe("develop");
    expect(await resolveBase(scope, found, NULL_LOGGER)).toBe("origin/main");
  });

  it("is refused with the fix when nothing names one and none is to be found", async () => {
    // `main` was assumed: a repository on `master` or `trunk` met a raw git usage screen.
    await expect(resolveBase(scope, none, NULL_LOGGER)).rejects.toThrow(OperatorError);
    await expect(resolveBase(scope, none, NULL_LOGGER)).rejects.toThrow(/--base/u);
  });

  it("is not needed for uncommitted work, and falls back to --since's own point", async () => {
    expect(await resolveBase({ ...scope, uncommitted: true }, none, NULL_LOGGER)).toBe("HEAD");
    expect(await resolveBase({ ...scope, since: "abc123" }, none, NULL_LOGGER)).toBe("abc123");
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
