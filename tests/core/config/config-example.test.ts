/**
 * The annotated config example is documentation that must stay true: every
 * key in it is accepted by the parser and every value resolves into a run's
 * settings. If a key is added to the schema and not to the example (or the
 * other way round), this file says so.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parse as parseYaml } from "yaml";

import { buildConfig } from "../../../src/core/config/config";
import { parseConfigFile } from "../../../src/core/config/parse";
import { REPO_ONLY_KEYS, ROOT_KEYS, SETTINGS_SECTION_KEYS } from "../../../src/core/config/schema";
import { sortedByCodePoint } from "../../../src/core/util/text";
import { loadConfigFiles } from "../../../src/providers/config/reader";

// Up out of tests/core/config/ to the repository root. The only test that
// reads a file by walking out of its own directory, which is why moving it
// into the mirror broke it and nothing else.
const TEMPLATES = join(import.meta.dirname, "..", "..", "..", "templates");
const EXAMPLE = join(TEMPLATES, "config.example.yaml");

function readYaml(path: string): unknown {
  return parseYaml(readFileSync(path, "utf8"));
}

describe("templates/config.example.yaml", () => {
  // The example carries the repository-only keys too, so it is read as a repository's file.
  const example = parseConfigFile(readYaml(EXAMPLE), EXAMPLE, "repo");

  it("documents every setting the schema accepts, and nothing else", () => {
    expect(sortedByCodePoint(Object.keys(example.values))).toEqual(
      sortedByCodePoint(["version", ...ROOT_KEYS]),
    );
    const settings = example.values["settings"] as Record<string, unknown>;
    expect(sortedByCodePoint(Object.keys(settings))).toEqual(
      sortedByCodePoint(SETTINGS_SECTION_KEYS),
    );
  });

  it("is refused as the machine's file, for the repository-only keys it documents", () => {
    expect(() => parseConfigFile(readYaml(EXAMPLE), EXAMPLE, "machine")).toThrow(
      /sets \['skills'\], which belongs to a repository's/u,
    );
  });

  it("resolves into a run's settings", () => {
    // Through the reader, so the relative skills path is anchored beside the file.
    const [file] = loadConfigFiles(
      { machine: "/nowhere/config.yaml", repo: EXAMPLE, isRepoNamed: true },
      { LLM_API_KEY: "k" },
    );
    const config = buildConfig({
      environment: { LLM_API_KEY: "k" },
      files: file === undefined ? [] : [file],
      providers: { names: ["local", "claude"], default: "local" },
      cpuCount: 4,
    });
    expect(config.reviewLang).toBe("Turkish");
    expect(config.provider).toBe("claude");
    expect(config.reportPolicy()).toEqual({ maxFindingsPerFile: 3 });
    expect(config.concurrency()).toEqual({ files: 4 });
    // A relative skills path is taken from beside the file that set it.
    const skills = config.skillSettings();
    expect(skills.path).toBe(join(TEMPLATES, "skills"));
    // The three shapes a mapping takes: a list, one bare glob (read as a
    // list), and [] for a skill switched off.
    expect(skills.mappings).toEqual({
      "api-rules": ["src/api/**/route.ts", "src/api/**/middlewares.ts"],
      "data-model": ["src/modules/**/models/**/*.ts"],
      "background-jobs": [],
    });
    // The baseline is written the other way round -- the paths first, then
    // the skills -- and each side takes a list or one bare string.
    expect(skills.defaults).toEqual([
      { globs: ["**/*.ts", "**/*.tsx"], skills: ["typescript-base", "naming"] },
      { globs: ["**/*"], skills: ["house-rules"] },
    ]);
  });
});

describe("the starters `reviewer init` writes", () => {
  it("templates/config.yaml is a valid machine file that names no repository-only key", () => {
    const path = join(TEMPLATES, "config.yaml");
    const machine = parseConfigFile(readYaml(path), path, "machine");
    for (const key of REPO_ONLY_KEYS) expect(machine.values).not.toHaveProperty(key);
    expect(machine.values["settings"]).toMatchObject({
      llm: { provider: "claude", "api-key": "${ANTHROPIC_API_KEY}" },
    });
  });

  it("templates/repo-config.yaml is a valid repository file that leaves the model to the machine", () => {
    const path = join(TEMPLATES, "repo-config.yaml");
    const repo = parseConfigFile(readYaml(path), path, "repo");
    expect(repo.values["settings"]).not.toHaveProperty("llm");
    expect(repo.values["skills"]).toEqual({ path: "skills", defaults: [], mappings: {} });
  });
});

describe("the schema's tables", () => {
  it("name only root keys as repository-only, and never a setting", () => {
    for (const key of REPO_ONLY_KEYS) {
      expect(ROOT_KEYS).toContain(key);
      expect(SETTINGS_SECTION_KEYS).not.toContain(key);
    }
  });
});
