import { describe, expect, it } from "bun:test";

import { type Skill } from "../../src/core/domain/skill";
import { isGlobMatch } from "../../src/core/skills/glob";
import { FrontmatterSkillParser } from "../../src/core/skills/parser";
import {
  MAX_SKILLS_BLOCK_CHARS,
  SkillRegistry,
  applyMappings,
} from "../../src/core/skills/registry";
import { compareCodePoints } from "../../src/core/util/text";
import { recordingLogger } from "../helpers/logging";

import { caseNamed, casesUnder, loadFixture } from "./fixtures";

const cases = loadFixture("skills");

describe("glob matching with Bun.Glob semantics", () => {
  it.each(casesUnder<{ path: string; pattern: string }, boolean>(cases, "glob"))(
    "$name",
    ({ input, expected }) => {
      expect(isGlobMatch(input.path, input.pattern)).toBe(expected);
    },
  );
});

describe("glob hyphens: literal outside a class, a range inside one", () => {
  it("matches a hyphen outside a character class", () => {
    expect(
      isGlobMatch("src/modules/x/y-module-service.ts", "src/modules/**/*-module-service.ts"),
    ).toBe(true);
    expect(
      isGlobMatch("src/modules/x/y-module-service.ts", "src/modules/**/*-provider-service.ts"),
    ).toBe(false);
    expect(isGlobMatch("a-b.ts", "a-b.ts")).toBe(true);
    expect(isGlobMatch("a_b.ts", "a-b.ts")).toBe(false);
  });

  it("still reads a hyphen as a range inside a class", () => {
    expect(isGlobMatch("v3.ts", "v[0-9].ts")).toBe(true);
    expect(isGlobMatch("v-.ts", "v[0-9].ts")).toBe(false);
    expect(isGlobMatch("v-.ts", "v[-].ts")).toBe(true);
  });
});

describe("frontmatter skill parser", () => {
  const parser = new FrontmatterSkillParser();
  const parseCases = casesUnder<{ text: string }, Skill | null>(cases, "parse");

  it.each(parseCases)("$name", ({ input, expected }) => {
    expect(parser.parse(input.text, "repo")).toEqual(expected);
  });

  it("gives no document a scope of its own: every parsed skill has globs: []", () => {
    // The scope is the config file's to give (skills.mappings); a document
    // that could scope itself would be a second place for the same
    // decision, and one of the two would eventually be wrong.
    const scopes = parseCases
      .map(({ input }) => parser.parse(input.text, "repo"))
      .filter((skill): skill is Skill => skill !== null)
      .map((skill) => skill.globs);
    expect(scopes.length).toBeGreaterThan(0);
    expect(scopes.every((globs) => globs.length === 0)).toBe(true);
  });
});

describe("skill registry", () => {
  const parser = new FrontmatterSkillParser();
  // A parsed skill has no scope of its own: the project's
  // `skills.mappings` gives it one. These scopes pin the registry's
  // behaviour exactly as the fixture was generated.
  const SCOPES = {
    "http-route": ["src/api/**/route.ts", "src/api/**/middlewares.ts"],
    "http-model": ["src/modules/**/models/*.ts"],
    bare: ["**/*.ts"],
    spaced: ["**/*.ts"],
    dashes: ["**/*.ts"],
    yaml11: ["**/*.ts"],
    numdesc: ["**/*.ts"],
    padded: ["**/*.ts"],
    globs: ["**/*.ts", "x/*.js"],
    nums: ["1", "2.5", "True"],
    empty: ["**/*.ts"],
    ws: ["**/*.ts"],
    crlf: ["**/*.ts"],
    tight: ["**/*.ts"],
  };
  const parsed = applyMappings(
    casesUnder<{ text: string }, Skill | null>(cases, "parse")
      .map((c) => parser.parse(c.input.text, "repo"))
      .filter((skill): skill is Skill => skill !== null)
      // Only the skills the fixture scoped take part; the rest were the
      // "keeps a skill the config file may scope" cases, unscoped by design.
      .filter((skill) => Object.hasOwn(SCOPES, skill.name)),
    SCOPES,
  );
  // Two long skills sharing a glob exercise the total budget and the
  // "last declaration wins" rule, exactly as the fixture was generated.
  const skill = (name: string, globs: string[], body: string): Skill => ({
    name,
    globs,
    body,
    source: "repo",
    description: "",
  });
  const registry = new SkillRegistry([
    ...parsed,
    skill("zz-long", ["src/api/**"], "L".repeat(5000)),
    skill("aa-long", ["src/api/**"], "M".repeat(5000)),
    skill("dup", ["x/*.js"], "first"),
    skill("dup", ["x/*.js"], "second"),
  ]);

  it("keeps one skill per name, the last declaration winning", () => {
    const { expected } = caseNamed<unknown, string[]>(cases, "registry/names");
    expect(registry.skillsFor("x/y.js").map((s) => s.body)).toContain("second");
    // Every skill in this registry matches one of the paths below (`nums`
    // declares the literal globs "1", "2.5" and "True"); the union of matches
    // over those paths is therefore the whole registry.
    const all = new Set<string>();
    for (const path of [
      "src/api/admin/x/route.ts",
      "src/modules/a/models/b.ts",
      "x/y.js",
      "anything.ts",
      "True",
    ]) {
      for (const s of registry.skillsFor(path)) all.add(s.name);
    }
    expect([...all].toSorted(compareCodePoints)).toEqual(expected);
  });

  it.each(casesUnder<{ path: string }, string[]>(cases, "skills_for"))(
    "skills_for $name",
    ({ input, expected }) => {
      expect(registry.skillsFor(input.path).map((s) => s.name)).toEqual(expected);
    },
  );

  it.each(casesUnder<{ path: string; max_skill_chars: number }, string>(cases, "render_for"))(
    "render_for $name",
    ({ input, expected }) => {
      expect(registry.renderFor(input.path, input.max_skill_chars).text).toBe(expected);
    },
  );
});

/**
 * A skill that fills two thirds of the block's ceiling: two of them do not fit,
 * which is the only way a skill is ever left out now that the total is a fixed
 * ceiling and not a setting.
 */
const bulkySkill = (name: string): Skill => ({
  name,
  globs: ["**/*.ts"],
  body: "B".repeat(Math.floor(MAX_SKILLS_BLOCK_CHARS * 0.7)),
  source: "repo",
  description: "",
});

/** Room for one bulky skill's body, so `skills.max-chars` is not what cuts here. */
const ROOMY_SKILL_CHARS = MAX_SKILLS_BLOCK_CHARS;

describe("the per-file skills block ceiling", () => {
  const lines: string[] = [];
  const registry = new SkillRegistry(
    [bulkySkill("aa-first"), bulkySkill("zz-second")],
    recordingLogger(lines),
  );
  const rendered = registry.renderFor("src/a.ts", ROOMY_SKILL_CHARS);

  it("warns, naming the file, the ceiling and what it left out", () => {
    // Left out means the file was not reviewed against that skill, which is a
    // warning and not a note: at the default level nobody would have seen it.
    expect(lines).toContain(
      `WARNING Skill budget reached for src/a.ts: the ${MAX_SKILLS_BLOCK_CHARS}-character ceiling on a file's skills block left ['zz-second'] out of the prompt, so that file was not reviewed against them. Shorten those skills, lower skills.max-chars, or narrow their globs. Each skill is said once; later files are not repeated.`,
    );
  });

  it("counts as applied only what the block carries", () => {
    expect(rendered.applied).toEqual(["aa-first"]);
    expect(rendered.text).toContain("## aa-first");
    expect(rendered.text).not.toContain("## zz-second");
    // The skill still matches the path; it simply did not reach the prompt.
    expect(registry.skillsFor("src/a.ts").map((s) => s.name)).toEqual(["aa-first", "zz-second"]);
  });

  it("says nothing when every matching skill fits", () => {
    const quiet: string[] = [];
    const roomy = new SkillRegistry(
      [bulkySkill("aa-first"), bulkySkill("zz-second")],
      recordingLogger(quiet),
    );
    // Two bodies cut to a third of the ceiling each: both fit, and the cut is
    // `skills.max-chars` doing its own job, not the block's ceiling.
    expect(roomy.renderFor("src/a.ts", Math.floor(MAX_SKILLS_BLOCK_CHARS / 3)).applied).toEqual([
      "aa-first",
      "zz-second",
    ]);
    expect(quiet.filter((line) => line.includes("budget"))).toEqual([]);
  });

  it("says each left-out skill once a run, not once a file", () => {
    // The same cap over a thousand files is one fact; a warning per file is a
    // log nobody reads, and the one that matters scrolls away.
    const spoken: string[] = [];
    const busy = new SkillRegistry(
      [bulkySkill("aa-first"), bulkySkill("zz-second")],
      recordingLogger(spoken),
    );
    for (const path of ["src/a.ts", "src/b.ts", "src/c.ts"])
      busy.renderFor(path, ROOMY_SKILL_CHARS);
    const warnings = spoken.filter((line) => line.includes("Skill budget reached"));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("src/a.ts");
    // Silence is about the log, not about the prompt: every later file still
    // loses the skill, and none of them reports it as applied.
    expect(busy.renderFor("src/d.ts", ROOMY_SKILL_CHARS).applied).toEqual(["aa-first"]);
  });

  it("keeps the first matching skill even when it alone overflows", () => {
    const huge: Skill = {
      ...bulkySkill("aa-first"),
      body: "B".repeat(MAX_SKILLS_BLOCK_CHARS + 10),
    };
    const tight = new SkillRegistry([huge], recordingLogger([]));
    const only = tight.renderFor("src/a.ts", MAX_SKILLS_BLOCK_CHARS + 10);
    expect(only.applied).toEqual(["aa-first"]);
    expect(only.text.length).toBeGreaterThan(MAX_SKILLS_BLOCK_CHARS);
  });
});

const ruleSkill = (name: string, globs: string[]): Skill => ({
  name,
  globs,
  body: "b",
  source: "repo",
  description: "",
});

describe("the project's skill mappings", () => {
  const loaded = [
    ruleSkill("routes", ["src/api/**"]),
    ruleSkill("models", []),
    ruleSkill("jobs", ["src/jobs/**"]),
  ];

  it("replaces a skill's own globs with the project's mapping", () => {
    const ruled = applyMappings(loaded, { routes: ["app/**/route.ts"] });
    expect(ruled.find((s) => s.name === "routes")?.globs).toEqual(["app/**/route.ts"]);
    expect(ruled.find((s) => s.name === "jobs")?.globs).toEqual(["src/jobs/**"]);
  });

  it("scopes a skill that the config file names, and nothing else does", () => {
    const ruled = applyMappings(loaded, { models: ["src/modules/**/models/*.ts"] });
    const registry = new SkillRegistry(ruled);
    expect(registry.skillsFor("src/modules/x/models/m.ts").map((s) => s.name)).toEqual(["models"]);
  });

  it("switches a skill off with an empty mapping", () => {
    const registry = new SkillRegistry(applyMappings(loaded, { jobs: [] }));
    expect(registry.skillsFor("src/jobs/nightly.ts")).toEqual([]);
  });

  it("leaves the skills untouched and warns when a mapping names nobody", () => {
    const lines: string[] = [];
    expect(applyMappings(loaded, { typo: ["**"] }, [], recordingLogger(lines))).toEqual(loaded);
    expect(lines).toContain(
      "WARNING Skill mapping for 'typo' matches no loaded skill; check the name.",
    );
  });
});

describe("the project's skill defaults", () => {
  const loaded = [ruleSkill("typescript-base", []), ruleSkill("routes", []), ruleSkill("jobs", [])];
  const defaults = [{ globs: ["**/*.ts"], skills: ["typescript-base"] }];

  it("scopes a skill the baseline names, for every file that glob matches", () => {
    const registry = new SkillRegistry(applyMappings(loaded, {}, defaults));
    expect(registry.skillsFor("src/api/route.ts").map((s) => s.name)).toEqual(["typescript-base"]);
    expect(registry.skillsFor("src/api/route.py")).toEqual([]);
  });

  it("adds the baseline to what a mapping gives the same skill, never replacing it", () => {
    // The two tables answer different questions -- "what is every TypeScript
    // file held to" and "what does this one skill also review" -- so a skill
    // in both reviews the union, and a glob repeated in both is kept once.
    const ruled = applyMappings(
      loaded,
      { "typescript-base": ["scripts/*.mjs", "**/*.ts"] },
      defaults,
    );
    expect(ruled.find((s) => s.name === "typescript-base")?.globs).toEqual([
      "**/*.ts",
      "scripts/*.mjs",
    ]);
  });

  it("lets a mapping of [] switch a defaulted skill off, baseline included", () => {
    const registry = new SkillRegistry(applyMappings(loaded, { "typescript-base": [] }, defaults));
    expect(registry.skillsFor("src/api/route.ts")).toEqual([]);
  });

  it("renders the baseline beside the skills a mapping scoped", () => {
    const registry = new SkillRegistry(applyMappings(loaded, { routes: ["src/api/**"] }, defaults));
    expect(registry.skillsFor("src/api/route.ts").map((s) => s.name)).toEqual([
      "routes",
      "typescript-base",
    ]);
  });

  it("warns about a skill in neither table, and about a default naming nobody", () => {
    const lines: string[] = [];
    applyMappings(
      loaded,
      {},
      [{ globs: ["**/*.ts"], skills: ["typescript-base", "typo"] }],
      recordingLogger(lines),
    );
    expect(lines).toContain(
      "WARNING Skill default for 'typo' matches no loaded skill; check the name.",
    );
    expect(lines.filter((line) => line.includes("is in neither the project's"))).toHaveLength(2);
    expect(lines.some((line) => line.includes("'typescript-base'"))).toBe(false);
  });
});
