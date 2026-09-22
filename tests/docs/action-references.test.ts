/**
 * The README and the action page reference the composite actions by the moving
 * major tag (`@v0`), never by one release: a release then touches no
 * documentation, and the examples stay true as tags land. The major is read
 * off package.json, so the day the version turns 1.0.0 this test asks for
 * `@v1` in the same breath.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Up out of tests/docs/ to the repository root.
const ROOT = join(import.meta.dirname, "..", "..");

const PAGES = ["README.md", join("docs", "github-action.md")];

/** Every `uses:` reference to one of this repository's actions, as `@<ref>`. */
const ACTION_REF = /husnuguner\/code-reviewer\/actions\/[a-z-]+@(?<reference>[^\s#]+)/gu;

const { version } = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
  version: string;
};
const major = `v${version.split(".", 1)[0] ?? ""}`;

/**
 * What a page may say after the `@`: the major tag, or the two placeholders the pinning section spells
 * out for a reader who wants something else.
 */
const ALLOWED: ReadonlySet<string> = new Set([major, "vX.Y.Z", "<full-sha>"]);

describe("how the documentation references the actions", () => {
  it.each(PAGES)("%s pins the moving major tag, never one release", (page) => {
    const text = readFileSync(join(ROOT, page), "utf8");
    const references = text
      .matchAll(ACTION_REF)
      .map((match) => match.groups?.["reference"] ?? "")
      .toArray();
    expect(references.length).toBeGreaterThan(0);
    expect(references.filter((reference) => !ALLOWED.has(reference))).toEqual([]);
  });

  it("reads the major off package.json, so 1.0.0 will ask for @v1 here", () => {
    expect(major).toMatch(/^v\d+$/u);
  });
});
