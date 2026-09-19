import { describe, expect, it } from "bun:test";

import { type Skill } from "../../src/core/domain/skill";
import { isGlobMatch } from "../../src/core/skills/glob";
import { FrontmatterSkillParser } from "../../src/core/skills/parser";
import { SkillRegistry, applyMappings } from "../../src/core/skills/registry";
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
    // The scope is the catalogue's to give (skills.mappings); a document
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
      // "keeps a skill the catalogue may scope" cases, unscoped by design.
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

  it.each(
    casesUnder<{ path: string; max_skill_chars: number; max_total_chars: number }, string>(
      cases,
      "render_for",
    ),
  )("render_for $name", ({ input, expected }) => {
    expect(registry.renderFor(input.path, input.max_skill_chars, input.max_total_chars)).toBe(
      expected,
    );
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

  it("scopes a skill that the catalogue names, and nothing else does", () => {
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
    expect(applyMappings(loaded, { typo: ["**"] }, recordingLogger(lines))).toEqual(loaded);
    expect(lines).toContain(
      "WARNING Skill mapping for 'typo' matches no loaded skill; check the name.",
    );
  });
});
