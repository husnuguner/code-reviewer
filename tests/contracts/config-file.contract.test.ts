import { describe, expect, it } from "bun:test";

import { type Config, buildConfig } from "../../src/core/config/config";
import { type ConfigFile, type SettingValues } from "../../src/core/config/config-file";
import { parseConfigFile } from "../../src/core/config/parse";
import { type ConfigHome } from "../../src/core/ports/config-directory";

import { casesUnder, expectContract, isErrorContract, loadFixture } from "./fixtures";

const cases = loadFixture("config-file");
const SOURCE = "/x/config.yaml";
const PROVIDERS = { names: ["local", "claude"], default: "local" };

describe("the reviewer's own checks on a decoded config.yaml", () => {
  // The version, where a setting may sit, and what the machine's file may not
  // say are policy; the parser does nothing else. Unknown keys and value
  // types are convict's, pinned under build/* below.
  const parseCases = casesUnder<{ home: ConfigHome; payload: unknown }>(cases, "parse");

  it.each(parseCases)("$name", ({ input, expected }) => {
    expectContract(() => parseConfigFile(input.payload, SOURCE, input.home), expected, {
      exactMessage: true,
    });
  });
});

/** A file as the reader would hand it over: content as written, `${...}` already expanded. */
function fileOf(home: ConfigHome, values: SettingValues): ConfigFile {
  return { source: `/${home}/config.yaml`, home, values };
}

/** The facade's fields a fixture may pin. */
type Pinned = Partial<
  Pick<
    Config,
    | "provider"
    | "model"
    | "reviewLang"
    | "verifyFindings"
    | "excludeGlobs"
    | "maxFindingsPerFile"
    | "skillsPath"
    | "skillMappings"
  >
>;

describe("what convict makes of the files", () => {
  // Two files merge lowest first, `llm` key by key and a list whole; an
  // unknown key anywhere is refused by its full path; every error is
  // reported at once. The messages are convict's and are pinned as such.
  it.each(
    casesUnder<{ machine: SettingValues | null; repo: SettingValues | null }, Pinned>(
      cases,
      "build",
    ),
  )("$name", ({ input, expected }) => {
    const files = [
      ...(input.machine === null ? [] : [fileOf("machine", input.machine)]),
      ...(input.repo === null ? [] : [fileOf("repo", input.repo)]),
    ];
    const build = (): Config =>
      buildConfig({ environment: { LLM_API_KEY: "k" }, files, providers: PROVIDERS, cpuCount: 4 });
    if (isErrorContract(expected)) {
      expectContract(build, expected, { exactMessage: true });
      return;
    }
    expect(build()).toMatchObject(expected);
  });

  it("leaves the files' values untouched", () => {
    const machine = fileOf("machine", { settings: { llm: { provider: "claude" } } });
    const repo = fileOf("repo", { settings: { llm: { model: "x" } } });
    buildConfig({
      environment: { LLM_API_KEY: "k" },
      files: [machine, repo],
      providers: PROVIDERS,
      cpuCount: 4,
    });
    expect(machine.values).toEqual({ settings: { llm: { provider: "claude" } } });
    expect(repo.values).toEqual({ settings: { llm: { model: "x" } } });
  });
});
