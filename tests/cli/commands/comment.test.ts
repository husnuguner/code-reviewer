/**
 * `reviewer comment`'s command line: the flags that decide a verdict.
 */

import { describe, expect, it } from "bun:test";

import { COMMENT } from "../../../src/cli/commands/comment";
import { UsageError } from "../../../src/cli/reviewer";
import { argumentsOf } from "../../helpers/command-line";

const comment = (argv: readonly string[]) => argumentsOf(COMMENT, ["comment", ...argv]);

describe("the command line", () => {
  const required = ["--findings", "f.ndjson", "--repo", "acme/app", "--pr", "7"];

  it("needs the findings, the repository and the pull request", () => {
    expect(() => comment([])).toThrow(UsageError);
    expect(() => comment(["--findings", "f.ndjson", "--repo", "acme/app"])).toThrow(UsageError);
    const parsed = comment(required);
    expect(parsed.findings).toBe("f.ndjson");
    expect(parsed.repo).toBe("acme/app");
    expect(parsed.pr).toBe(7);
  });

  it("comments, and supersedes nothing, unless asked", () => {
    const parsed = comment(required);
    expect(parsed.requestChangesOn).toEqual([]);
    expect(parsed.supersede).toBe(false);
    expect(parsed.dryRun).toBe(false);
    expect(parsed.provider).toBe("github");
  });

  it("takes the severities that make a review a request for changes", () => {
    const parsed = comment([...required, "--request-changes-on", "Bug, security"]);
    expect(parsed.requestChangesOn).toEqual(["bug", "security"]);
    // `none` is the spelled-out way to say "never", and it is the default.
    expect(comment([...required, "--request-changes-on", "none"]).requestChangesOn).toEqual([]);
  });

  it("refuses a severity the vocabulary does not have", () => {
    expect(() => comment([...required, "--request-changes-on", "blocker"])).toThrow(UsageError);
  });

  it("refuses a pull request number that is not one", () => {
    expect(() => comment(["--findings", "f", "--repo", "a/b", "--pr", "seven"])).toThrow(
      UsageError,
    );
  });

  it("supersedes when asked", () => {
    expect(comment([...required, "--supersede"]).supersede).toBe(true);
  });
});
