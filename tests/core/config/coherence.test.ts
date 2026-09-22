/**
 * Settings that pass validation one by one and contradict each other as a whole. Every line here names
 * something the run would quietly not do, which is why it is said at WARNING and not left to a reader of
 * the config file.
 */

import { describe, expect, it } from "bun:test";

import { configIncoherences } from "../../../src/core/config/coherence";
import { type Config, buildConfig } from "../../../src/core/config/config";

const PROVIDERS = { names: ["local", "claude"], default: "local" };

/** A configuration from the environment and, when given, one repository file's values: no disk. */
function configOf(
  environment: Record<string, string>,
  repoValues?: Record<string, unknown>,
): Config {
  return buildConfig({
    environment: { LLM_API_KEY: "k", ...environment },
    ...(repoValues && {
      files: [{ source: ".review/config.yaml", home: "repo", values: repoValues }],
    }),
    providers: PROVIDERS,
    cpuCount: 4,
  });
}

/** The skills directory, without which nothing about skills can disagree. */
const WITH_SKILLS = { REVIEW_SKILLS_PATH: "skills" };

/** The per-skill cap as a repository's file states it: it lives beside the skills, alias-free. */
function perSkillCap(chars: number): Record<string, unknown> {
  return { skills: { "max-chars": chars } };
}

describe("a configuration that agrees with itself", () => {
  it("says nothing about the defaults", () => {
    expect(configIncoherences(configOf({}))).toEqual([]);
  });

  it("says nothing about a per-skill cap that carries a body", () => {
    const config = configOf(WITH_SKILLS, perSkillCap(10_000));
    expect(configIncoherences(config)).toEqual([]);
  });
});

describe("the skills tables against the skills path", () => {
  it("warns when the tables scope skills that no path loads", () => {
    // The baseline has no environment alias; it comes from the repository's file.
    const config = configOf(
      { REVIEW_SKILL_MAPPINGS: '{"api-rules": ["src/api/**"]}' },
      { skills: { defaults: [{ globs: "**/*.ts", skills: "typescript-base" }] } },
    );
    const [line] = configIncoherences(config);
    expect(line).toContain("skills.path is empty");
    expect(line).toContain("scope 2 entries");
  });

  it("counts one entry as one", () => {
    const config = configOf({ REVIEW_SKILL_MAPPINGS: '{"api-rules": ["src/api/**"]}' });
    expect(configIncoherences(config)[0]).toContain("scope 1 entry");
  });

  it("says nothing about the cap while skills are off: no block is built", () => {
    // Without a skills path the cap decides nothing, so it cannot disagree.
    const config = configOf({}, perSkillCap(0));
    expect(configIncoherences(config)).toEqual([]);
  });
});

describe("the per-skill cap", () => {
  it("warns that a zero cap sends the names and none of the rules", () => {
    const config = configOf(WITH_SKILLS, perSkillCap(0));
    expect(configIncoherences(config)).toEqual([
      "skills.max-chars is 0, which cuts every skill's body to nothing: a file's prompt would carry the skills' names and none of their rules.",
    ]);
  });
});
