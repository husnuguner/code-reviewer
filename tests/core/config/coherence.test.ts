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

describe("a configuration that agrees with itself", () => {
  it("says nothing about the defaults", () => {
    expect(configIncoherences(configOf({}))).toEqual([]);
  });

  it("says nothing when the per-skill cap fits inside the block", () => {
    const config = configOf({
      ...WITH_SKILLS,
      REVIEW_MAX_SKILL_CHARS: "10000",
      REVIEW_MAX_SKILLS_TOTAL_CHARS: "18000",
    });
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

  it("says nothing about caps while skills are off: no block is built", () => {
    // Without a skills path the caps decide nothing, so they cannot disagree.
    const config = configOf({
      REVIEW_MAX_SKILL_CHARS: "20000",
      REVIEW_MAX_SKILLS_TOTAL_CHARS: "1",
    });
    expect(configIncoherences(config)).toEqual([]);
  });
});

describe("the two skill caps against each other", () => {
  it("warns when one skill may fill the whole block", () => {
    const config = configOf({
      ...WITH_SKILLS,
      REVIEW_MAX_SKILL_CHARS: "20000",
      REVIEW_MAX_SKILLS_TOTAL_CHARS: "18000",
    });
    const [line] = configIncoherences(config);
    expect(line).toContain("settings.max-skill-chars=20000 is larger than");
    expect(line).toContain("settings.max-skills-total-chars=18000");
  });

  it("warns that a zero block cap leaves every skill but the first out", () => {
    const config = configOf({ ...WITH_SKILLS, REVIEW_MAX_SKILLS_TOTAL_CHARS: "0" });
    expect(configIncoherences(config)).toEqual([
      "settings.max-skills-total-chars is 0, so only the first matching skill reaches a file's prompt however many match; the rest are left out of every review.",
    ]);
  });

  it("warns that a zero per-skill cap sends the names and none of the rules", () => {
    const config = configOf({ ...WITH_SKILLS, REVIEW_MAX_SKILL_CHARS: "0" });
    expect(configIncoherences(config)[0]).toContain("settings.max-skill-chars is 0");
  });

  it("reports both zero caps, in a fixed order", () => {
    const config = configOf({
      ...WITH_SKILLS,
      REVIEW_MAX_SKILL_CHARS: "0",
      REVIEW_MAX_SKILLS_TOTAL_CHARS: "0",
    });
    expect(configIncoherences(config).map((line) => line.split(" ", 1)[0])).toEqual([
      "settings.max-skill-chars",
      "settings.max-skills-total-chars",
    ]);
  });
});
