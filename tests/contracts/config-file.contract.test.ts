import { describe, expect, it } from "bun:test";

import { type SettingValues, layerSettings } from "../../src/core/config/config-file";
import { parseConfigFile } from "../../src/core/config/parse";
import { type ConfigHome } from "../../src/core/ports/config-directory";

import { casesUnder, expectContract, loadFixture } from "./fixtures";

const cases = loadFixture("config-file");
const SOURCE = "/x/config.yaml";

describe("parsing config.yaml", () => {
  // Every case runs the same way, including the ones whose message names a
  // value the JavaScript way (`null`, `'a'`) and the unrecognised-key case
  // this build refuses at parse time. Each expectation says what this
  // program does; there is no second implementation to be measured against.
  const parseCases = casesUnder<{ home: ConfigHome; payload: unknown }>(cases, "parse");

  it.each(parseCases)("$name", ({ input, expected }) => {
    expectContract(() => parseConfigFile(input.payload, SOURCE, input.home), expected, {
      exactMessage: true,
    });
  });
});

/**
 * A key nobody declared is refused by name, whatever shape it came in: a
 * typo, a spelling from someone's other tool, or a setting this build does
 * not have. There is no migration table behind the message -- the tool is
 * unreleased -- so the accepted set IS the answer.
 */
describe("keys the schema does not declare", () => {
  it.each([
    ["a typo", { exlude: ["**/*.md"] }],
    ["a snake_case spelling", { max_findings_per_file: 2 }],
    ["a camelCase spelling", { maxFindingsPerFile: 2 }],
    ["a setting this build has not", { severities: ["bug"] }],
  ])("refuses %s under settings and names the accepted set", (_what, settings) => {
    const call = (): unknown => parseConfigFile({ settings }, SOURCE, "repo");
    expect(call).toThrow(/\/x\/config\.yaml: settings has unrecognised setting\(s\)/u);
    expect(call).toThrow(/known: \['exclude', 'language', 'llm'/u);
  });

  it("refuses the old two-level layout at the root and names the two sections", () => {
    expect(() => parseConfigFile({ defaults: {}, projects: {} }, SOURCE, "repo")).toThrow(
      /\/x\/config\.yaml has unrecognised key\(s\) \['defaults', 'projects'\]; known: \['settings', 'skills'\]/u,
    );
  });

  it("points a setting written at the root to the settings section", () => {
    // The likeliest slip after the section was introduced: the message says
    // where the key goes rather than only that it is unknown here.
    expect(() => parseConfigFile({ language: "tr" }, SOURCE, "repo")).toThrow(
      /has \['language'\] at the root; a setting goes under the settings section/u,
    );
  });

  it("refuses an unknown key in an llm section, in either home", () => {
    for (const home of ["repo", "machine"] as const) {
      expect(() => parseConfigFile({ settings: { llm: { apiKey: "K" } } }, SOURCE, home)).toThrow(
        /settings\.llm has unrecognised key\(s\) \['apiKey'\]; known: \['api-key'/u,
      );
    }
  });
});

describe("what the machine's file may not say", () => {
  it("refuses skills, naming where they belong", () => {
    expect(() => parseConfigFile({ skills: { path: "x" } }, SOURCE, "machine")).toThrow(
      /sets \['skills'\], which belongs to a repository's \.review\/config\.yaml/u,
    );
  });

  it("accepts the same key in the repository's file", () => {
    expect(parseConfigFile({ skills: { path: "x" } }, SOURCE, "repo").values).toEqual({
      skills: { path: "x" },
    });
  });
});

describe("the parsed value", () => {
  it("is flat: the settings section's keys beside skills, whatever section each was written under", () => {
    const file = parseConfigFile(
      { settings: { language: "tr", llm: { model: "x" } }, skills: { path: "s" } },
      SOURCE,
      "repo",
    );
    expect(file.values).toEqual({ language: "tr", llm: { model: "x" }, skills: { path: "s" } });
  });
});

describe("the repository's file on top of the machine's", () => {
  it.each(
    casesUnder<{ machine: SettingValues | null; repo: SettingValues | null }, SettingValues>(
      cases,
      "layer",
    ),
  )("$name", ({ input, expected }) => {
    expect(layerSettings(input.machine, input.repo)).toEqual(expected);
  });

  it("leaves both inputs untouched", () => {
    const machine = { llm: { provider: "claude" } };
    const repo = { llm: { model: "x" } };
    layerSettings(machine, repo);
    expect(machine).toEqual({ llm: { provider: "claude" } });
    expect(repo).toEqual({ llm: { model: "x" } });
  });
});
