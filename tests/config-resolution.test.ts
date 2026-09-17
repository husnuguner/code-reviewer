/**
 * The project catalogue on disk, and how one project resolves into a run's
 * configuration: command line > environment (real and `.env`) > project > default.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  type Config,
  ConfigError,
  buildConfig,
  defaultConcurrency,
} from "../src/core/config/config";
import { CatalogError } from "../src/core/util/errors";
import { pySorted } from "../src/core/util/py";
import { loadCatalog, loadRunConfig } from "../src/infra/config/loader";
import { configHome, configPath } from "../src/infra/config/paths";

import { isErrorContract, loadFixture } from "./contracts/fixtures";

const CATALOG = {
  version: 3,
  defaults: {
    llm: { provider: "claude", model: "claude-opus-5", "api-key": "ANTHROPIC_API_KEY" },
    language: "en",
    "max-file-chars": 4000,
    prompts: ["prompts/system.md", "prompts/{{project}}.md"],
    skills: { path: "~/.config/reviewer/skills/{{project}}" },
    "local-path": "~/src/{{project}}",
  },
  projects: {
    app: {
      language: "tr",
      prompts: ["prompts/app.md"],
      skills: {
        path: ".review/skills",
        mappings: { "api-routes": ["src/api/**/route.ts"], models: "src/modules/**/models/*.ts" },
      },
      exclude: ["**/*.spec.ts", "**/migrations/*.ts"],
      "max-findings-per-file": 2,
    },
    legacy: {
      llm: { provider: "local", "base-url": "http://127.0.0.1:1234/v1", "api-key": "lm-studio" },
    },
  },
};

const PROVIDERS = ["claude", "local"];

/** A throwaway home directory, working directory and catalogue for one test. */
interface Scratch {
  readonly root: string;
  readonly home: string;
  readonly cwd: string;
  readonly catalogFile: string;
  readonly homeEnvFile: string;
  readonly cwdEnvFile: string;
}

function scratch(): Scratch {
  const root = mkdtempSync(join(tmpdir(), "reviewer-config-"));
  const home = join(root, "home");
  const cwd = join(root, "cwd");
  mkdirSync(join(home, ".config", "reviewer"), { recursive: true });
  mkdirSync(cwd, { recursive: true });
  const catalogFile = join(root, "config.yaml");
  writeFileSync(catalogFile, JSON.stringify(CATALOG), "utf8");
  return {
    root,
    home,
    cwd,
    catalogFile,
    homeEnvFile: join(home, ".config", "reviewer", ".env"),
    cwdEnvFile: join(cwd, ".env"),
  };
}

/** An environment that defines none of the run's settings but the essentials. */
function cleanEnvironment(s: Scratch, extra: Record<string, string> = {}): Record<string, string> {
  return {
    XDG_CONFIG_HOME: join(s.home, ".config"),
    // What the catalogue's defaults name; LLM_API_KEY would be the override layer.
    ANTHROPIC_API_KEY: "llm-key",
    ...extra,
  };
}

/** The environment a run without a catalogue needs: the key under its own name. */
function environmentOnly(s: Scratch, extra: Record<string, string> = {}): Record<string, string> {
  return cleanEnvironment(s, { LLM_API_KEY: "llm-key", ...extra });
}

function load(
  s: Scratch,
  options: {
    project?: string | null;
    configFile?: string | null;
    env?: Record<string, string>;
    overrides?: Record<string, unknown>;
  } = {},
): Config {
  return loadRunConfig({
    project: options.project ?? null,
    configFile: options.configFile ?? null,
    ...(options.overrides && { overrides: options.overrides }),
    providerNames: PROVIDERS,
    cpuCount: 8,
    environment: options.env ?? cleanEnvironment(s),
    cwd: s.cwd,
    home: s.home,
  });
}

// -- paths -----------------------------------------------------------------

/** A disk that has only the pre-YAML `config.json`. */
function isLegacyOnly(path: string): boolean {
  return path.endsWith("config.json");
}

describe("configuration paths", () => {
  it("honours XDG_CONFIG_HOME and falls back to ~/.config", () => {
    expect(configHome({ XDG_CONFIG_HOME: "/xdg" }, "/home/u")).toBe("/xdg/reviewer");
    expect(configHome({}, "/home/u")).toBe("/home/u/.config/reviewer");
    expect(configHome({ XDG_CONFIG_HOME: "~/cfg" }, "/home/u")).toBe("/home/u/cfg/reviewer");
  });

  it("lets --config beat REVIEWER_CONFIG beat the config home", () => {
    expect(configPath("/explicit.json", { REVIEWER_CONFIG: "/env.json" }, "/home/u")).toBe(
      "/explicit.json",
    );
    expect(configPath(null, { REVIEWER_CONFIG: "/env.json" }, "/home/u")).toBe("/env.json");
    expect(configPath(null, {}, "/home/u")).toBe("/home/u/.config/reviewer/config.yaml");
  });

  it("falls back to a config.json from before the format change when config.yaml is absent", () => {
    expect(configPath(null, {}, "/home/u", isLegacyOnly)).toBe(
      "/home/u/.config/reviewer/config.json",
    );
    expect(configPath(null, {}, "/home/u", () => true)).toBe(
      "/home/u/.config/reviewer/config.yaml",
    );
    expect(configPath(null, {}, "/home/u", () => false)).toBe(
      "/home/u/.config/reviewer/config.yaml",
    );
  });
});

// -- parsing on disk -------------------------------------------------------

describe("loading the catalogue", () => {
  it("parses the projects", () => {
    const s = scratch();
    const catalog = loadCatalog(s.catalogFile, cleanEnvironment(s), undefined, s.home);
    expect(catalog).not.toBeNull();
    expect(pySorted(catalog?.projects.keys() ?? [])).toEqual(["app", "legacy"]);
    expect(catalog?.project("app").name).toBe("app");
  });

  it("treats a missing catalogue as no catalogue", () => {
    const s = scratch();
    expect(loadCatalog(null, cleanEnvironment(s), undefined, s.home)).toBeNull();
  });

  it("treats an explicitly named missing file as an error", () => {
    const s = scratch();
    expect(() =>
      loadCatalog(join(s.root, "nope.json"), cleanEnvironment(s), undefined, s.home),
    ).toThrow(/No config file/u);
  });

  it("refuses a future schema version", () => {
    const s = scratch();
    const path = join(s.root, "future.json");
    writeFileSync(path, JSON.stringify({ version: 99 }), "utf8");
    expect(() => loadCatalog(path, cleanEnvironment(s), undefined, s.home)).toThrow(
      /understands up to/u,
    );
  });

  it("reads the catalogue as YAML, which JSON also is", () => {
    const s = scratch();
    const yamlFile = join(s.root, "c.yaml");
    writeFileSync(
      yamlFile,
      [
        "version: 3",
        "projects:",
        "  one:",
        "    local-path: ~/src/one",
        "    max-findings-per-file: 1   # a comment, which JSON could not carry",
      ].join("\n"),
      "utf8",
    );
    const catalog = loadCatalog(yamlFile, cleanEnvironment(s), undefined, s.home);
    expect(catalog?.project("one").settings["max-findings-per-file"]).toBe(1);
  });

  it("names the file when it is not valid YAML", () => {
    const s = scratch();
    const path = join(s.root, "broken.yaml");
    writeFileSync(path, "projects: [unclosed", "utf8");
    expect(() => loadCatalog(path, cleanEnvironment(s), undefined, s.home)).toThrow(
      /not valid YAML/u,
    );
  });
});

// -- secrets ---------------------------------------------------------------

describe("secrets", () => {
  it("reads the model's key from the variable the catalogue names", () => {
    const s = scratch();
    expect(load(s, { project: "app", configFile: s.catalogFile }).apiKey).toBe("llm-key");
  });

  it("says which variable is missing when the key is unset", () => {
    const s = scratch();
    const environment = cleanEnvironment(s);
    delete environment["ANTHROPIC_API_KEY"];
    expect(() => load(s, { project: "app", configFile: s.catalogFile, env: environment })).toThrow(
      /ANTHROPIC_API_KEY/u,
    );
  });

  it("finds a key placed in the .env beside the catalogue", () => {
    const s = scratch();
    const environment = cleanEnvironment(s);
    delete environment["ANTHROPIC_API_KEY"];
    writeFileSync(s.homeEnvFile, "ANTHROPIC_API_KEY=from-dotenv\n", "utf8");
    expect(load(s, { project: "app", configFile: s.catalogFile, env: environment }).apiKey).toBe(
      "from-dotenv",
    );
  });
});

// -- resolution ------------------------------------------------------------

describe("resolution", () => {
  it("carries project settings into the flat config", () => {
    const s = scratch();
    const config = load(s, { project: "app", configFile: s.catalogFile });
    expect(config.reviewLang).toBe("Turkish");
    expect(config.localPath).toBe("~/src/app");
    expect(config.excludeGlobs).toEqual(["**/*.spec.ts", "**/migrations/*.ts"]);
    expect(config.maxFindingsPerFile).toBe(2);
  });

  it("carries the skills map, one bare glob becoming a list", () => {
    const s = scratch();
    const config = load(s, { project: "app", configFile: s.catalogFile });
    expect(config.skillSettings()).toEqual({
      path: ".review/skills",
      mappings: { "api-routes": ["src/api/**/route.ts"], models: ["src/modules/**/models/*.ts"] },
    });
  });

  it("lets the catalogue's defaults fill what a project leaves out, and the project win the rest", () => {
    const s = scratch();
    const bare = load(s, { project: "legacy", configFile: s.catalogFile });
    expect(bare.reviewLang).toBe("English");
    expect(bare.maxFileChars).toBe(4000);
    // `{{project}}` in a shared path is the selected project's name.
    expect(bare.promptFiles).toEqual(["prompts/system.md", "prompts/legacy.md"]);
    // The directory comes from the defaults; the mappings are a project's own.
    expect(bare.skillSettings()).toEqual({
      path: "~/.config/reviewer/skills/legacy",
      mappings: {},
    });
    expect(bare.maxFindingsPerFile).toBe(3); // the system default, set nowhere

    const app = load(s, { project: "app", configFile: s.catalogFile });
    expect(app.reviewLang).toBe("Turkish");
    expect(app.maxFileChars).toBe(4000);
    expect(app.maxFindingsPerFile).toBe(2);
    expect(app.promptFiles).toEqual(["prompts/app.md"]); // replaces, does not append
  });

  it("takes the model settings from the catalogue, the key by name or as given", () => {
    const s = scratch();
    const app = load(s, { project: "app", configFile: s.catalogFile });
    expect(app.providerSettings()).toEqual({
      provider: "claude",
      apiKey: "llm-key", // ANTHROPIC_API_KEY, named in defaults, read from the environment
      baseUrl: null,
      modelName: "claude-opus-5",
    });
    // The project's llm merges key by key over the defaults' llm.
    const legacy = load(s, { project: "legacy", configFile: s.catalogFile });
    expect(legacy.providerSettings()).toEqual({
      provider: "local",
      apiKey: "lm-studio", // not spelled like a variable: the key itself
      baseUrl: "http://127.0.0.1:1234/v1",
      modelName: "claude-opus-5",
    });
    expect(legacy.localPath).toBe("~/src/legacy");
  });

  it("reads the prompt files from the environment as CSV or JSON", () => {
    const s = scratch();
    const csv = load(s, {
      project: "app",
      configFile: s.catalogFile,
      env: cleanEnvironment(s, { REVIEW_PROMPT_FILES: " a.md, ,~/b.md " }),
    });
    expect(csv.promptFiles).toEqual(["a.md", "~/b.md"]);
    const json = load(s, {
      project: "app",
      configFile: s.catalogFile,
      env: cleanEnvironment(s, { REVIEW_PROMPT_FILES: '["x.md"]' }),
    });
    expect(json.promptFiles).toEqual(["x.md"]);
  });

  it("reads the skills map from the environment as JSON, which beats the catalogue", () => {
    const s = scratch();
    const config = load(s, {
      project: "app",
      configFile: s.catalogFile,
      env: cleanEnvironment(s, { REVIEW_SKILL_MAPPINGS: '{"models": [" a/** ", ""]}' }),
    });
    expect(config.skillSettings().mappings).toEqual({ models: ["a/**"] });
  });

  it("refuses a skills map that is not an object", () => {
    const s = scratch();
    const attempt = (): Config =>
      load(s, {
        project: "app",
        configFile: s.catalogFile,
        env: cleanEnvironment(s, { REVIEW_SKILL_MAPPINGS: "not json" }),
      });
    expect(attempt).toThrow(ConfigError);
    expect(attempt).toThrow(/REVIEW_SKILL_MAPPINGS/u);
  });

  it("lets the environment override the catalogue", () => {
    const s = scratch();
    const config = load(s, {
      project: "app",
      configFile: s.catalogFile,
      env: cleanEnvironment(s, { REVIEW_LANG: "en" }),
    });
    // The file says Turkish; the environment outranks it.
    expect(config.reviewLang).toBe("English");
  });

  it("lets a .env file override the catalogue too", () => {
    const s = scratch();
    writeFileSync(s.cwdEnvFile, "REVIEW_LANG=en\n", "utf8");
    expect(load(s, { project: "app", configFile: s.catalogFile }).reviewLang).toBe("English");
  });

  it("ranks the config-home .env above the working-directory .env", () => {
    const s = scratch();
    writeFileSync(s.cwdEnvFile, "REVIEW_LANG=en\nREVIEW_SKILLS_PATH=from-cwd\n", "utf8");
    writeFileSync(s.homeEnvFile, "REVIEW_LANG=tr\n", "utf8");
    const config = load(s, { env: environmentOnly(s) });
    expect(config.reviewLang).toBe("Turkish");
    expect(config.skillsPath).toBe("from-cwd");
  });

  it("lets the real environment override every .env file", () => {
    const s = scratch();
    writeFileSync(s.homeEnvFile, "REVIEW_LANG=tr\n", "utf8");
    expect(load(s, { env: environmentOnly(s, { REVIEW_LANG: "en" }) }).reviewLang).toBe("English");
  });

  it("lets the command line override the environment", () => {
    const s = scratch();
    const config = load(s, {
      project: "app",
      configFile: s.catalogFile,
      env: cleanEnvironment(s, { REVIEW_LANG: "en" }),
      overrides: { reviewLang: "tr" },
    });
    expect(config.reviewLang).toBe("Turkish");
  });

  it("reports an unrecognised project setting rather than ignoring it", () => {
    const s = scratch();
    const path = join(s.root, "typo.json");
    writeFileSync(
      path,
      JSON.stringify({ projects: { x: { "local-path": "~/src/x", exlude: ["*.md"] } } }),
      "utf8",
    );
    expect(() => load(s, { project: "x", configFile: path })).toThrow(/unrecognised setting/u);
  });

  it("configures the run from the environment alone without a catalogue", () => {
    const s = scratch();
    const config = load(s, {
      env: environmentOnly(s, { REVIEW_LOCAL_PATH: "~/src/from-env", REVIEW_LANG: "tr" }),
    });
    expect(config.localPath).toBe("~/src/from-env");
    expect(config.reviewLang).toBe("Turkish");
  });

  it("refuses --project without a catalogue", () => {
    const s = scratch();
    const attempt = (): Config =>
      load(s, { project: "app", env: cleanEnvironment(s, { REVIEW_LOCAL_PATH: "~/src/x" }) });
    expect(attempt).toThrow(CatalogError);
    expect(attempt).toThrow(/needs a catalogue/u);
  });
});

// -- the settings schema, pinned by fixtures --------------------------------

/** The fixture's snake_case view of a `Config`, including its derived values. */
function snapshot(config: Config): Record<string, unknown> {
  return {
    provider: config.provider,
    model_name: config.modelName,
    api_key: config.apiKey,
    base_url: config.baseUrl,
    local_path: config.localPath,
    max_file_chars: config.maxFileChars,
    skills_path: config.skillsPath,
    max_skill_chars: config.maxSkillChars,
    max_skills_total_chars: config.maxSkillsTotalChars,
    max_context_chars: config.maxContextChars,
    max_findings_per_file: config.maxFindingsPerFile,
    verify_findings: config.verifyFindings,
    review_lang: config.reviewLang,
    exclude_paths: config.excludePaths,
    exclude_globs: config.excludeGlobs,
    max_concurrent_files: config.maxConcurrentFiles,
  };
}

interface SchemaInput {
  env: Record<string, string>;
  cpu: number;
}

function build(input: SchemaInput): Config {
  return buildConfig(input.env, { providerNames: PROVIDERS, cpuCount: input.cpu });
}

describe("the settings schema", () => {
  const cases = loadFixture("config");
  const schemaCases = cases.filter((c) => c.name.startsWith("config/"));

  it.each(cases.filter((c) => c.name.startsWith("default_concurrency/")))(
    "$name",
    ({ input, expected }) => {
      const { cpu } = input as { cpu: number | null };
      expect(defaultConcurrency(cpu)).toEqual(expected);
    },
  );

  it.each(schemaCases.filter((c) => !isErrorContract(c.expected)))(
    "$name",
    ({ input, expected }) => {
      expect(snapshot(build(input as SchemaInput))).toEqual(expected);
    },
  );

  // pydantic's ValidationError is this implementation's ConfigError; the first
  // line of the message is the contract.
  it.each(schemaCases.filter((c) => isErrorContract(c.expected)))("$name", ({ input }) => {
    const attempt = (): Config => build(input as SchemaInput);
    expect(attempt).toThrow(ConfigError);
    expect(attempt).toThrow(/^1 validation error for Config/u);
  });

  it("demands the model's key, unless the flow builds no model", () => {
    const environment = { LLM_PROVIDER: "local" };
    expect(() => buildConfig(environment, { providerNames: PROVIDERS, cpuCount: 4 })).toThrow(
      ConfigError,
    );
    // `--preview` resolves the same configuration but calls nobody, so the
    // key it would never send is not a reason to refuse the run.
    const config = buildConfig(environment, {
      providerNames: PROVIDERS,
      cpuCount: 4,
      requiresModel: false,
    });
    expect(config.providerSettings().apiKey).toBe("");
    // Everything else about the model is still validated.
    expect(() =>
      buildConfig(
        { LLM_PROVIDER: "nonesuch" },
        { providerNames: PROVIDERS, cpuCount: 4, requiresModel: false },
      ),
    ).toThrow(ConfigError);
  });
});

describe("the setting groups", () => {
  const config = build({
    env: {
      LLM_PROVIDER: "local",
      LLM_API_KEY: "k",
      PR_REVIEW_REPO: "acme/widgets",
      REVIEW_LANG: "tr",
      REVIEW_EXCLUDE_PATHS: "docs/**, *.lock",
      REVIEW_INLINE_SEVERITIES: "Bug,Security",
      REVIEW_MAX_FINDINGS_PER_FILE: "3",
      REVIEW_MAX_PRIOR_COMMENT_CHARS: "500",
      PR_REVIEW_MAX_FILE_CHARS: "4000",
      REVIEW_MAX_SKILL_CHARS: "1000",
      REVIEW_MAX_SKILLS_TOTAL_CHARS: "2000",
      REVIEW_MAX_CONCURRENT_PRS: "2",
      REVIEW_MAX_CONCURRENT_FILES: "5",
    },
    cpu: 4,
  });

  it("maps the per-file settings, appending the command line's globs", () => {
    expect(config.fileReviewSettings(["*.min.js"])).toEqual({
      exclude: ["docs/**", "*.lock", "*.min.js"],
      language: "Turkish",
      maxFileChars: 4000,
      maxSkillChars: 1000,
      maxSkillsTotalChars: 2000,
      maxContextChars: 6000,
    });
    expect(config.fileReviewSettings().exclude).toEqual(["docs/**", "*.lock"]);
  });

  it("maps the report policy", () => {
    expect(config.reportPolicy()).toEqual({ maxFindingsPerFile: 3 });
  });

  it("maps the concurrency limit", () => {
    expect(config.concurrency()).toEqual({ files: 5 });
  });

  it("is immutable once built", () => {
    expect(Object.isFrozen(config)).toBe(true);
  });
});
