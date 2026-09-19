/**
 * The project catalogue on disk, and how one project resolves into a run's
 * configuration: command line > environment (real and `.env`) > project > default.
 */

import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import {
  type Config,
  ConfigError,
  buildConfig,
  defaultConcurrency,
} from "../../../src/core/config/config";
import { CatalogError } from "../../../src/core/util/errors";
import { sortedByCodePoint } from "../../../src/core/util/text";
import {
  configHome,
  configPath,
  findGitRoot,
  findRepoConfig,
} from "../../../src/providers/catalog/paths";
import { loadCatalog } from "../../../src/providers/catalog/reader";
import { loadRunConfig } from "../../../src/providers/config/loader";
import { casesUnder, isErrorContract, loadFixture } from "../../contracts/fixtures";

const CATALOG = {
  version: 1,
  defaults: {
    llm: { provider: "claude", model: "claude-opus-5", "api-key": "ANTHROPIC_API_KEY" },
    language: "en",
    "max-file-chars": 4000,
    skills: { path: "~/.config/reviewer/skills/{{project}}" },
    "local-path": "~/src/{{project}}",
  },
  projects: {
    app: {
      language: "tr",
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

/** What the composition root tells the configuration: the registered names and the default. */
const PROVIDERS = { names: ["local", "claude"], default: "local" };

/** A throwaway home directory, working directory and catalogue for one test. */
interface Scratch {
  readonly root: string;
  readonly home: string;
  readonly cwd: string;
  readonly catalogFile: string;
  readonly homeEnvFile: string;
  readonly cwdEnvFile: string;
}

/** Every temporary tree made by this file, removed when it is done. */
const temporaryRoots: string[] = [];

afterAll(() => {
  for (const root of temporaryRoots) rmSync(root, { recursive: true, force: true });
});

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "reviewer-config-"));
  temporaryRoots.push(root);
  return root;
}

function scratch(): Scratch {
  const root = temporaryRoot();
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
    providers: PROVIDERS,
    cpuCount: 8,
    environment: options.env ?? cleanEnvironment(s),
    cwd: s.cwd,
  });
}

// -- paths -----------------------------------------------------------------

/** A throwaway disk for the path walks: a home with a config home, and a checkout under it. */
interface Disk {
  readonly root: string;
  readonly home: string;
  /** What `XDG_CONFIG_HOME` is set to. */
  readonly xdg: string;
  readonly repo: string;
  /** A working directory two levels into the checkout. */
  readonly deep: string;
  /** A working directory outside any checkout. */
  readonly elsewhere: string;
}

function disk(): Disk {
  const root = temporaryRoot();
  const home = join(root, "home");
  const xdg = join(home, ".config");
  const repo = join(home, "work", "repo");
  const deep = join(repo, "src", "deep");
  const elsewhere = join(root, "elsewhere");
  for (const directory of [join(xdg, "reviewer"), deep, elsewhere]) {
    mkdirSync(directory, { recursive: true });
  }
  return { root, home, xdg, repo, deep, elsewhere };
}

/** Writes a file, making its directory. */
function touch(path: string, content = ""): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content, "utf8");
}

describe("configuration paths", () => {
  it("honours XDG_CONFIG_HOME and falls back to ~/.config", () => {
    expect(configHome({ XDG_CONFIG_HOME: "/xdg" })).toBe("/xdg/reviewer");
    expect(configHome({})).toBe(join(homedir(), ".config", "reviewer"));
    expect(configHome({ XDG_CONFIG_HOME: "~/cfg" })).toBe(join(homedir(), "cfg", "reviewer"));
  });

  it("lets --config beat REVIEWER_CONFIG beat the repository's own beat the config home", () => {
    const d = disk();
    const repoConfig = join(d.repo, ".review", "config.yaml");
    touch(repoConfig);
    const environment = { XDG_CONFIG_HOME: d.xdg };
    expect(
      configPath("/explicit.json", { ...environment, REVIEWER_CONFIG: "/env.json" }, d.deep),
    ).toBe("/explicit.json");
    expect(configPath(null, { ...environment, REVIEWER_CONFIG: "/env.json" }, d.deep)).toBe(
      "/env.json",
    );
    // The repository's own wins over the machine's, and is found from any
    // subdirectory -- the way git finds its repository.
    expect(configPath(null, environment, d.deep)).toBe(repoConfig);
    expect(configPath(null, environment, d.elsewhere)).toBe(join(d.xdg, "reviewer", "config.yaml"));
  });

  it("does not mistake the home directory for a repository", () => {
    const d = disk();
    touch(join(d.home, ".review", "config.yaml"));
    mkdirSync(join(d.repo, ".git"));
    // The walk for `.review/config.yaml` goes through the home directory like
    // any other, so a `~/.review/` is a catalogue for every checkout under it...
    expect(findRepoConfig(d.repo)).toBe(join(d.home, ".review", "config.yaml"));
    // ...but `init` never writes there: it asks for a git root, not a `.review/`.
    expect(findGitRoot(d.deep)).toBe(d.repo);
    expect(findGitRoot(d.elsewhere)).toBeNull();
  });

  it("takes a .git file for a repository root too, as a worktree or submodule has", () => {
    const d = disk();
    mkdirSync(join(d.repo, ".git"));
    const worktree = join(d.repo, "trees", "feature");
    touch(join(worktree, ".git"), "gitdir: ../../.git/worktrees/feature\n");
    expect(findGitRoot(join(worktree, "src"))).toBe(worktree);
  });

  it("falls back to a config.json from before the format change when config.yaml is absent", () => {
    const d = disk();
    const environment = { XDG_CONFIG_HOME: d.xdg };
    const configHomeDirectory = join(d.xdg, "reviewer");
    expect(configPath(null, environment, d.elsewhere)).toBe(
      join(configHomeDirectory, "config.yaml"),
    );
    touch(join(configHomeDirectory, "config.json"));
    expect(configPath(null, environment, d.elsewhere)).toBe(
      join(configHomeDirectory, "config.json"),
    );
    touch(join(configHomeDirectory, "config.yaml"));
    expect(configPath(null, environment, d.elsewhere)).toBe(
      join(configHomeDirectory, "config.yaml"),
    );
  });
});

// -- parsing on disk -------------------------------------------------------

describe("loading the catalogue", () => {
  it("parses the projects", () => {
    const s = scratch();
    const catalog = loadCatalog(s.catalogFile, cleanEnvironment(s));
    expect(catalog).not.toBeNull();
    expect(sortedByCodePoint(catalog?.projects.keys() ?? [])).toEqual(["app", "legacy"]);
    expect(catalog?.project("app").name).toBe("app");
  });

  it("treats a missing catalogue as no catalogue", () => {
    const s = scratch();
    expect(loadCatalog(null, cleanEnvironment(s))).toBeNull();
  });

  it("treats an explicitly named missing file as an error", () => {
    const s = scratch();
    expect(() => loadCatalog(join(s.root, "nope.json"), cleanEnvironment(s))).toThrow(
      /No config file/u,
    );
  });

  it("refuses a future schema version", () => {
    const s = scratch();
    const path = join(s.root, "future.json");
    writeFileSync(path, JSON.stringify({ version: 99 }), "utf8");
    expect(() => loadCatalog(path, cleanEnvironment(s))).toThrow(/understands up to/u);
  });

  it("reads the catalogue as YAML, which JSON also is", () => {
    const s = scratch();
    const yamlFile = join(s.root, "c.yaml");
    writeFileSync(
      yamlFile,
      [
        "version: 1",
        "projects:",
        "  one:",
        "    local-path: ~/src/one",
        "    max-findings-per-file: 1   # a comment, which JSON could not carry",
      ].join("\n"),
      "utf8",
    );
    const catalog = loadCatalog(yamlFile, cleanEnvironment(s));
    expect(catalog?.project("one").settings["max-findings-per-file"]).toBe(1);
  });

  it("names the file when it is not valid YAML", () => {
    const s = scratch();
    const path = join(s.root, "broken.yaml");
    writeFileSync(path, "projects: [unclosed", "utf8");
    expect(() => loadCatalog(path, cleanEnvironment(s))).toThrow(/not valid YAML/u);
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

  it("does not demand the key the catalogue names when the environment supplies LLM_API_KEY", () => {
    // The CI case: the workflow hands the key in as LLM_API_KEY, while the
    // repository's committed config says `api-key: ANTHROPIC_API_KEY`. That
    // variable is the override layer above the catalogue -- a run that has
    // it has its key, and the catalogue's *name* for a different variable
    // must not be demanded as well.
    const s = scratch();
    const environment = cleanEnvironment(s, { LLM_API_KEY: "from-ci" });
    delete environment["ANTHROPIC_API_KEY"];
    const config = load(s, { project: "app", configFile: s.catalogFile, env: environment });
    expect(config.apiKey).toBe("from-ci");
    // Everything else the catalogue says still applies.
    expect(config.provider).toBe("claude");
    expect(config.model).toBe("claude-opus-5");
  });

  it("does not demand a key the catalogue names when the flow builds no model", () => {
    // `--preview` decides scope and calls nobody; a pre-flight that refused to
    // run without a key it would never send is a pre-flight nobody can run
    // before they have one. The name is carried, the lookup is deferred.
    const s = scratch();
    const environment = cleanEnvironment(s);
    delete environment["ANTHROPIC_API_KEY"];
    const config = loadRunConfig({
      project: "app",
      configFile: s.catalogFile,
      requiresModel: false,
      providers: PROVIDERS,
      cpuCount: 8,
      environment,
      cwd: s.cwd,
    });
    expect(config.apiKey).toBe("");
    expect(config.provider).toBe("claude"); // everything else still resolves
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
      // Relative in the file, anchored to the file's own directory here.
      path: join(s.root, ".review/skills"),
      mappings: { "api-routes": ["src/api/**/route.ts"], models: ["src/modules/**/models/*.ts"] },
    });
  });

  it("anchors every relative path the catalogue names to the catalogue's own directory", () => {
    // One base for every relative path a catalogue names: "beside this file".
    // A repository's .review/config.yaml therefore says
    // `skills: { path: skills }` without knowing where the checkout is.
    const s = scratch();
    const config = load(s, { project: "app", configFile: s.catalogFile });
    expect(config.skillSettings().path).toBe(join(s.root, ".review/skills"));
    // An anchored path is left alone: `~` and `/` already say where.
    const legacy = load(s, { project: "legacy", configFile: s.catalogFile });
    expect(legacy.skillSettings().path).toBe("~/.config/reviewer/skills/legacy");
    // The environment's path comes from no file, so it is not re-anchored:
    // the checkout is its natural base, as it always was.
    const fromEnvironment = load(s, {
      project: "app",
      configFile: s.catalogFile,
      env: cleanEnvironment(s, { REVIEW_SKILLS_PATH: "rules" }),
    });
    expect(fromEnvironment.skillSettings().path).toBe("rules");
  });

  it("lets the catalogue's defaults fill what a project leaves out, and the project win the rest", () => {
    const s = scratch();
    const bare = load(s, { project: "legacy", configFile: s.catalogFile });
    expect(bare.reviewLang).toBe("English");
    expect(bare.maxFileChars).toBe(4000);
    // The directory comes from the defaults; the mappings are a project's own.
    // `{{project}}` in that shared path is the selected project's name.
    expect(bare.skillSettings()).toEqual({
      path: "~/.config/reviewer/skills/legacy",
      mappings: {},
    });
    expect(bare.maxFindingsPerFile).toBe(3); // the system default, set nowhere

    const app = load(s, { project: "app", configFile: s.catalogFile });
    expect(app.reviewLang).toBe("Turkish");
    expect(app.maxFileChars).toBe(4000);
    expect(app.maxFindingsPerFile).toBe(2);
  });

  it("takes the model settings from the catalogue, the key by name or as given", () => {
    const s = scratch();
    const app = load(s, { project: "app", configFile: s.catalogFile });
    // The provider's name is the selection key and travels beside the knobs,
    // not among them (`modelProviders.create(config.provider, config.llmSettings())`).
    expect(app.provider).toBe("claude");
    expect(app.llmSettings()).toEqual({
      apiKey: "llm-key", // ANTHROPIC_API_KEY, named in defaults, read from the environment
      baseUrl: null,
      model: "claude-opus-5",
    });
    // The project's llm merges key by key over the defaults' llm.
    const legacy = load(s, { project: "legacy", configFile: s.catalogFile });
    expect(legacy.provider).toBe("local");
    expect(legacy.llmSettings()).toEqual({
      apiKey: "lm-studio", // not spelled like a variable: the key itself
      baseUrl: "http://127.0.0.1:1234/v1",
      model: "claude-opus-5",
    });
    expect(legacy.localPath).toBe("~/src/legacy");
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

  it("treats an empty environment variable as unset, not as an override", () => {
    // `REVIEW_SKILLS_PATH=` in a shell, or a CI input left blank and exported
    // anyway, is not an instruction to disable skills: it must fall through
    // to the project the way an unset variable does. Otherwise a repository's
    // own .review/config.yaml is silently overridden by nothing.
    const s = scratch();
    const config = load(s, {
      project: "app",
      configFile: s.catalogFile,
      env: cleanEnvironment(s, { REVIEW_SKILLS_PATH: "", REVIEW_LANG: "  " }),
    });
    expect(config.skillSettings().path).toBe(join(s.root, ".review/skills"));
    expect(config.reviewLang).toBe("Turkish");
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
    model_name: config.model,
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
  return buildConfig(input.env, { providers: PROVIDERS, cpuCount: input.cpu });
}

describe("the settings schema", () => {
  const cases = loadFixture("config");
  const schemaCases = casesUnder<SchemaInput, Record<string, unknown>>(cases, "config");

  it.each(casesUnder<{ cpu: number | null }, number>(cases, "default_concurrency"))(
    "default_concurrency/$name",
    ({ input, expected }) => {
      expect(defaultConcurrency(input.cpu)).toEqual(expected);
    },
  );

  it.each(schemaCases.filter((c) => !isErrorContract(c.expected)))(
    "config/$name",
    ({ input, expected }) => {
      expect(snapshot(build(input))).toEqual(expected);
    },
  );

  // pydantic's ValidationError is this implementation's ConfigError; the first
  // line of the message is the contract.
  it.each(schemaCases.filter((c) => isErrorContract(c.expected)))("config/$name", ({ input }) => {
    const attempt = (): Config => build(input);
    expect(attempt).toThrow(ConfigError);
    expect(attempt).toThrow(/^1 validation error for Config/u);
  });

  it("demands the model's key, unless the flow builds no model", () => {
    const environment = { LLM_PROVIDER: "local" };
    expect(() => buildConfig(environment, { providers: PROVIDERS, cpuCount: 4 })).toThrow(
      ConfigError,
    );
    // `--preview` resolves the same configuration but calls nobody, so the
    // key it would never send is not a reason to refuse the run.
    const config = buildConfig(environment, {
      providers: PROVIDERS,
      cpuCount: 4,
      requiresModel: false,
    });
    expect(config.llmSettings().apiKey).toBe("");
    // Everything else about the model is still validated.
    expect(() =>
      buildConfig(
        { LLM_PROVIDER: "nonesuch" },
        { providers: PROVIDERS, cpuCount: 4, requiresModel: false },
      ),
    ).toThrow(ConfigError);
  });
});

describe("the setting groups", () => {
  const config = build({
    env: {
      LLM_PROVIDER: "local",
      LLM_API_KEY: "k",
      REVIEW_LANG: "tr",
      REVIEW_EXCLUDE_PATHS: "docs/**, *.lock",
      REVIEW_MAX_FINDINGS_PER_FILE: "3",
      REVIEW_MAX_FILE_CHARS: "4000",
      REVIEW_MAX_SKILL_CHARS: "1000",
      REVIEW_MAX_SKILLS_TOTAL_CHARS: "2000",
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
