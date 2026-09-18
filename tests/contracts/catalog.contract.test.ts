import { describe, expect, it } from "bun:test";

import { type Catalog, type ProjectSpec } from "../../src/core/catalog/catalog";
import { parseCatalog } from "../../src/core/catalog/parse";

import { type FixtureCase, caseNamed, casesUnder, expectContract, loadFixture } from "./fixtures";

const cases = loadFixture("catalog");
const SOURCE = "/x/config.yaml";

/** The fixture's flat spelling of a parsed catalogue. */
function catalogDict(catalog: Catalog): unknown {
  return {
    source: catalog.source,
    projects: Object.fromEntries([...catalog.projects].map(([name, p]) => [name, projectDict(p)])),
  };
}

function projectDict(project: ProjectSpec): unknown {
  return { name: project.name, settings: project.settings };
}

function validCatalog(): Catalog {
  const valid = cases.find((c) => c.name === "parse/valid") as FixtureCase<{ payload: unknown }>;
  return parseCatalog(valid.input.payload, SOURCE);
}

describe("parsing config.yaml", () => {
  // Every case runs the same way, including the ones whose message names a
  // value the JavaScript way (`null`, `'a'`) and the unrecognised-key case
  // this build refuses at parse time. Each expectation says what this
  // program does; there is no second implementation to be measured against.
  const parseCases = casesUnder<{ payload: unknown }>(cases, "parse");

  it.each(parseCases)("$name", ({ input, expected }) => {
    expectContract(() => catalogDict(parseCatalog(input.payload, SOURCE)), expected, {
      exactMessage: true,
    });
  });
});

/**
 * A key nobody declared is refused by name, whatever shape it came in: a
 * typo, a spelling from someone's other tool, or a setting this build does
 * not have. There is no migration table behind the message -- the schema is
 * at v1 and has had no earlier shape -- so the accepted set IS the answer.
 */
describe("keys the schema does not declare", () => {
  it.each([
    ["a typo", { exlude: ["**/*.md"] }],
    ["a snake_case spelling", { max_findings_per_file: 2 }],
    ["a camelCase spelling", { maxFindingsPerFile: 2 }],
    ["a setting this build has not", { severities: ["bug"] }],
  ])("refuses %s on a project and names the accepted set", (_what, settings) => {
    const call = (): Catalog => parseCatalog({ projects: { app: settings } }, SOURCE);
    expect(call).toThrow(/Project 'app' has unrecognised setting\(s\)/u);
    expect(call).toThrow(/known: \['exclude', 'language', 'llm', 'local-path'/u);
  });

  it("refuses an unknown key in defaults and in an llm section", () => {
    expect(() => parseCatalog({ defaults: { languge: "tr" } }, SOURCE)).toThrow(
      /defaults has unrecognised setting\(s\) \['languge'\]/u,
    );
    expect(() => parseCatalog({ defaults: { llm: { apiKey: "K" } } }, SOURCE)).toThrow(
      /defaults llm has unrecognised key\(s\) \['apiKey'\]; known: \['api-key'/u,
    );
  });
});

describe("selecting a project", () => {
  it.each(
    casesUnder<{ name: string | null }>(cases, "project").filter(
      (c) => c.name.startsWith("'") || c.name === "None",
    ),
  )("project $name", ({ input, expected }) => {
    expectContract(() => projectDict(validCatalog().project(input.name)), expected, {
      exactMessage: true,
    });
  });

  it("picks the only project when none is named", () => {
    const only = parseCatalog({ projects: { only: { "local-path": "~/src/only" } } }, SOURCE);
    expect(only.project(null).name).toBe(
      caseNamed<unknown, string>(cases, "project/single_without_name").expected,
    );
  });

  it("refuses to pick when no project is defined", () => {
    const expected = cases.find((c) => c.name === "project/none_defined")?.expected;
    expectContract(() => parseCatalog({}, SOURCE).project(null), expected, { exactMessage: true });
  });
});
