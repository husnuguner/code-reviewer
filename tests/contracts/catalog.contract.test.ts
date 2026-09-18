import { describe, expect, it } from "bun:test";

import { type Catalog, type ProjectSpec } from "../../src/core/catalog/catalog";
import { parseCatalog } from "../../src/core/catalog/parse";
import { CatalogError } from "../../src/core/util/errors";

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
 * The posting era's keys, answered by name.
 *
 * Hand-written rather than generated: these assert the one thing an operator
 * upgrading a v2 file actually experiences, and "unknown setting" would read
 * like a typo when the truth is that the feature left the tool.
 */
describe("keys this build removed", () => {
  it.each([
    ["repositories", { repositories: { providers: { github: { kind: "github" } } } }],
    ["repo_providers", { repo_providers: {} }],
  ])("refuses the root section %s and says why", (key, payload) => {
    expect(() => parseCatalog(payload, SOURCE)).toThrow(CatalogError);
    expect(() => parseCatalog(payload, SOURCE)).toThrow(
      new RegExp(`'${key}' was removed in schema version 3`, "u"),
    );
  });

  it.each([
    ["repository", { repository: { provider: "github", name: "acme/app" } }],
    ["severities", { severities: ["bug"] }],
    ["max-prior-comment-chars", { "max-prior-comment-chars": 3000 }],
    ["max-concurrent-prs", { "max-concurrent-prs": 2 }],
  ])("refuses the project setting %s and says what to do instead", (key, settings) => {
    const payload = { projects: { app: settings } };
    expect(() => parseCatalog(payload, SOURCE)).toThrow(
      new RegExp(`'${key}' was removed in schema version 3`, "u"),
    );
  });

  it("names the replacement rather than only the removal", () => {
    expect(() => parseCatalog({ projects: { app: { repository: {} } } }, SOURCE)).toThrow(
      /local-path/u,
    );
    expect(() => parseCatalog({ projects: { app: { severities: [] } } }, SOURCE)).toThrow(
      /--fail-on/u,
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
