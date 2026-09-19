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

import { parseConfigFile } from "../../../src/core/config/parse";
import { resolveConfig } from "../../../src/core/config/resolver";
import { REPO_ONLY_KEYS, SETTING_KEYS } from "../../../src/core/config/schema";
import { sortedByCodePoint } from "../../../src/core/util/text";

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
    expect(sortedByCodePoint(Object.keys(example.values))).toEqual(sortedByCodePoint(SETTING_KEYS));
  });

  it("is refused as the machine's file, for the repository-only keys it documents", () => {
    expect(() => parseConfigFile(readYaml(EXAMPLE), EXAMPLE, "machine")).toThrow(
      /sets \['skills'\], which belongs to a repository's/u,
    );
  });

  it("resolves into a run's settings", () => {
    const config = resolveConfig({
      files: { machine: null, repo: example },
      sources: { processEnv: { LLM_API_KEY: "k" }, envFiles: [] },
      configHome: "/tmp/none",
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
  });
});

describe("the starters `reviewer init` writes", () => {
  it("templates/config.yaml is a valid machine file that names no repository-only key", () => {
    const path = join(TEMPLATES, "config.yaml");
    const machine = parseConfigFile(readYaml(path), path, "machine");
    for (const key of REPO_ONLY_KEYS) expect(machine.values).not.toHaveProperty(key);
    expect(machine.values.llm).toMatchObject({
      provider: "claude",
      "api-key": "ANTHROPIC_API_KEY",
    });
  });

  it("templates/repo-config.yaml is a valid repository file that leaves the model to the machine", () => {
    const path = join(TEMPLATES, "repo-config.yaml");
    const repo = parseConfigFile(readYaml(path), path, "repo");
    expect(repo.values).not.toHaveProperty("llm");
    expect(repo.values.skills).toEqual({ path: "skills", mappings: {} });
  });
});

describe("the schema's tables", () => {
  it("name only setting keys as repository-only", () => {
    for (const key of REPO_ONLY_KEYS) expect(SETTING_KEYS).toContain(key);
  });
});
