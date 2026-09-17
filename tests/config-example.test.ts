/**
 * The annotated catalogue example is documentation that must stay true:
 * every key in it is accepted by the parser and every value resolves into a
 * run's settings. If a key is added to the schema and not to the example (or
 * the other way round), this file says so.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

import { PROJECT_SETTING_KEYS, parseCatalog } from "../src/core/catalog/catalog";
import { resolveConfig } from "../src/core/config/resolver";
import { pySorted } from "../src/core/util/py";

const EXAMPLE = join(import.meta.dirname, "..", "docs", "config.example.yaml");

describe("docs/config.example.yaml", () => {
  const catalog = parseCatalog(parseYaml(readFileSync(EXAMPLE, "utf8")), EXAMPLE);

  it("parses, with the documented projects", () => {
    expect(catalog.projects.keys().toArray()).toEqual(["shop", "another"]);
  });

  it("documents every setting the schema accepts in defaults and on the project, and nothing else", () => {
    expect(pySorted(Object.keys(catalog.defaults))).toEqual(pySorted(PROJECT_SETTING_KEYS));
    const onProject = Object.keys(catalog.project("shop").settings);
    expect(pySorted(onProject)).toEqual(pySorted(PROJECT_SETTING_KEYS));
  });

  it("resolves into a run's settings", () => {
    const config = resolveConfig({
      catalog,
      project: "shop",
      sources: { processEnv: { LLM_API_KEY: "k" }, envFiles: [] },
      configHome: "/tmp/none",
      providerNames: ["local", "claude"],
      cpuCount: 4,
    });
    expect(config.reviewLang).toBe("Turkish");
    // The project's own values win over the defaults ...
    expect(config.reportPolicy()).toEqual({ maxFindingsPerFile: 2 });
    expect(config.excludeGlobs).toEqual(["**/*.md"]);
    expect(config.concurrency()).toEqual({ files: 4 });
    // ... the skills directory comes from the defaults, the mappings are its own ...
    const skills = config.skillSettings();
    expect(skills.path).toBe("~/.config/reviewer/skills/shop"); // {{project}} spelled out
    expect(Object.keys(skills.mappings)).toHaveLength(11);
    expect(skills.mappings["medusa-route"]).toEqual(["src/api/**/route.ts"]);
    // ... and prompts replace the defaults' list.
    expect(config.promptFiles).toEqual(["prompts/system.md", "prompts/shop.md"]);
  });

  it("names every skill of the shipped Medusa library, and only those", () => {
    const { mappings } = catalog.project("shop").settings.skills as { mappings: object };
    const rules = Object.keys(mappings);
    const shipped = readFileSync(
      join(import.meta.dirname, "..", "docs", "example-skills", "library-README.md"),
      "utf8",
    );
    for (const name of rules) expect(shipped).toContain(`\`${name}\``);
  });
});
