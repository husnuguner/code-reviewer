/**
 * Skills are read from the checkout under review: a directory on this machine,
 * or a path inside the working tree. Same skills either way, and the per-file
 * matching on top of them is what makes a review use a file's own rules.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { SkillRegistry } from "../src/core/skills/registry";
import { pySorted } from "../src/core/util/py";
import {
  DirectorySkillSource,
  WorktreeSkillSource,
  isLocalSkillsPath,
} from "../src/infra/skills/sources";

// A skill document carries no scope of its own; the mapping gives it one.
const ROUTE = "---\nname: medusa-route\n---\nRoute rules.\n";
const MODEL = "---\nname: medusa-model\n---\nModel rules.\n";
const README = "# Skills\n\nThis directory holds review skills.\n";

/** A throwaway working tree with a nested skills directory. */
function checkout(): string {
  const root = mkdtempSync(join(tmpdir(), "reviewer-skills-"));
  mkdirSync(join(root, ".review", "skills", "nested"), { recursive: true });
  writeFileSync(join(root, ".review", "skills", "route.md"), ROUTE, "utf8");
  writeFileSync(join(root, ".review", "skills", "nested", "model.md"), MODEL, "utf8");
  writeFileSync(join(root, ".review", "skills", "README.md"), README, "utf8");
  writeFileSync(join(root, ".review", "skills", "notes.txt"), "not markdown", "utf8");
  return root;
}

describe("skills read from the working tree", () => {
  it("reads markdown recursively and skips non-skill documents", async () => {
    const skills = await new WorktreeSkillSource(checkout(), ".review/skills").load();
    expect(pySorted(skills.map((s) => s.name))).toEqual(["medusa-model", "medusa-route"]);
  });

  it("loads nothing for an empty path or a missing directory", async () => {
    const root = checkout();
    expect(await new WorktreeSkillSource(root, "").load()).toEqual([]);
    expect(await new WorktreeSkillSource(root, "does/not/exist").load()).toEqual([]);
  });

  it("feeds a registry that matches skills to the paths the project maps them to", async () => {
    // The scope comes from the catalogue's mappings and nowhere else: a
    // source that loaded these two skills without a mapping would give the
    // registry nothing that matches.
    const registry = await SkillRegistry.build(
      [new WorktreeSkillSource(checkout(), ".review/skills")],
      undefined,
      {
        "medusa-route": ["src/api/**/route.ts"],
        "medusa-model": ["src/modules/**/models/*.ts"],
      },
    );
    expect(registry.skillsFor("src/api/admin/route.ts").map((s) => s.name)).toEqual([
      "medusa-route",
    ]);
    expect(registry.skillsFor("src/modules/a/models/b.ts").map((s) => s.name)).toEqual([
      "medusa-model",
    ]);
    expect(registry.skillsFor("README.md")).toEqual([]);
  });

  it("survives a source that fails, reviewing with the lenses alone", async () => {
    const failing = {
      sourceName: "repo",
      load: (): Promise<never> => Promise.reject(new Error("listing failed")),
    };
    const registry = await SkillRegistry.build([failing]);
    expect(registry.skillsFor("anything.ts")).toEqual([]);
  });
});

describe("skills read from a directory on this machine", () => {
  it("reads the directory itself, wherever it is", async () => {
    const directory = join(checkout(), ".review", "skills");
    const skills = await new DirectorySkillSource(directory).load();
    expect(pySorted(skills.map((s) => s.name))).toEqual(["medusa-model", "medusa-route"]);
  });

  it("loads nothing for an empty or missing directory", async () => {
    const missing = join(checkout(), "nope");
    expect(await new DirectorySkillSource("").load()).toEqual([]);
    expect(await new DirectorySkillSource(missing).load()).toEqual([]);
  });

  it("tells a local path from a repository-relative one", () => {
    expect(isLocalSkillsPath("/Users/me/.config/reviewer/skills")).toBe(true);
    expect(isLocalSkillsPath("~/.config/reviewer/skills")).toBe(true);
    expect(isLocalSkillsPath(" ~ ")).toBe(true);
    expect(isLocalSkillsPath(".review/skills")).toBe(false);
    expect(isLocalSkillsPath("skills")).toBe(false);
    expect(isLocalSkillsPath("")).toBe(false);
  });
});
