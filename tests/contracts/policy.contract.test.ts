import { describe, expect, it } from "bun:test";

import { type ChangedFileEntry } from "../../src/core/domain/changed-file";
import { POLICY_DIR, policyChanges, policyWarning } from "../../src/core/review/policy";

import { casesUnder, loadFixture } from "./fixtures";

const policy = loadFixture("policy");

/** A change set of the named paths; the patch does not matter to policy. */
function changeSet(paths: readonly string[]): ChangedFileEntry[] {
  return paths.map((filename) => ({ filename, status: "modified", patch: "@@ -1 +1 @@\n-a\n+b" }));
}

describe("which changed files are policy", () => {
  it.each(
    casesUnder<{ files: string[]; policy_paths: string[] }, string[]>(policy, "policy_changes"),
  )("$name", ({ input, expected }) => {
    expect(policyChanges(changeSet(input.files), input.policy_paths)).toEqual(expected);
  });

  it("names the directory every checkout keeps its policy in", () => {
    expect(POLICY_DIR).toBe(".review");
  });

  it("reports a path once however many entries name it", () => {
    const twice = changeSet([".review/config.yaml", ".review/config.yaml"]);
    expect(policyChanges(twice, [])).toEqual([".review/config.yaml"]);
  });
});

describe("the warning a policy change earns", () => {
  it.each(casesUnder<{ changed: string[] }, string>(policy, "policy_warning"))(
    "$name",
    ({ input, expected }) => {
      expect(policyWarning(input.changed)).toBe(expected);
    },
  );
});
