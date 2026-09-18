/**
 * `review-comment`'s command line: the flags that decide a verdict.
 */

import { describe, expect, it } from "bun:test";

import { parseArguments } from "../../src/cli/comment";
import { UsageError } from "../../src/cli/program";

describe("the command line", () => {
  const required = ["--findings", "f.ndjson", "--repo", "acme/app", "--pr", "7"];

  it("comments, and supersedes nothing, unless asked", () => {
    const parsed = parseArguments(required);
    expect(parsed.requestChangesOn).toEqual([]);
    expect(parsed.supersede).toBe(false);
  });

  it("takes the severities that make a review a request for changes", () => {
    const parsed = parseArguments([...required, "--request-changes-on", "Bug, security"]);
    expect(parsed.requestChangesOn).toEqual(["bug", "security"]);
    // `none` is the spelled-out way to say "never", and it is the default.
    expect(parseArguments([...required, "--request-changes-on", "none"]).requestChangesOn).toEqual(
      [],
    );
  });

  it("refuses a severity the vocabulary does not have", () => {
    expect(() => parseArguments([...required, "--request-changes-on", "blocker"])).toThrow(
      UsageError,
    );
  });

  it("supersedes when asked", () => {
    expect(parseArguments([...required, "--supersede"]).supersede).toBe(true);
  });
});

/** A transport for a test that must never reach it. */
