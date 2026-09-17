import { describe, expect, it } from "vitest";

import { type Catalog, type ProjectSpec, parseCatalog } from "../../src/core/catalog/catalog";
import { CatalogError } from "../../src/core/util/errors";

import { type FixtureCase, casesUnder, expectContract, loadFixture } from "./fixtures";

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
  const parseCases = casesUnder<{ payload: unknown }>(cases, "parse").filter(
    (c) => c.divergence === undefined,
  );

  it.each(parseCases)("%s", ({ input, expected }) => {
    expectContract(() => catalogDict(parseCatalog(input.payload, SOURCE)), expected, {
      exactMessage: true,
    });
  });

  it("rejects an unrecognised project key when the file is parsed (documented divergence)", () => {
    const { input, divergence } = cases.find(
      (c) => c.name === "parse/project_unknown_key_parses_in_python",
    ) as FixtureCase<{ payload: unknown }>;
    expect(divergence).toBeDefined();
    const message = (
      cases.find((c) => c.name === "project_values/unknown_key")?.expected as { message: string }
    ).message;
    expect(() => parseCatalog(input.payload, SOURCE)).toThrow(new CatalogError(message));
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
  )("project %s", ({ input, expected }) => {
    expectContract(() => projectDict(validCatalog().project(input.name)), expected, {
      exactMessage: true,
    });
  });

  it("picks the only project when none is named", () => {
    const only = parseCatalog({ projects: { only: { "local-path": "~/src/only" } } }, SOURCE);
    expect(only.project(null).name).toBe(
      cases.find((c) => c.name === "project/single_without_name")?.expected,
    );
  });

  it("refuses to pick when no project is defined", () => {
    const expected = cases.find((c) => c.name === "project/none_defined")?.expected;
    expectContract(() => parseCatalog({}, SOURCE).project(null), expected, { exactMessage: true });
  });
});
