/**
 * The two config files on disk, and how they resolve into a run's configuration:
 * command line > environment (real and `.env`) > the repository's file > the machine's file > default.
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
import { ConfigFileError } from "../../../src/core/util/errors";
import { loadRunConfig } from "../../../src/providers/config/loader";
import {
  configHome,
  configPaths,
  findGitRoot,
  insideCheckout,
  findRepoConfig,
} from "../../../src/providers/config/paths";
import { loadConfigFiles } from "../../../src/providers/config/reader";
import { casesUnder, isErrorContract, loadFixture } from "../../contracts/fixtures";
import { recordingLogger } from "../../helpers/logging";

/** What the composition root tells the configuration: the registered names and the default. */
const PROVIDERS = { names: ["local", "claude"], default: "local" };

/** The machine's file: how the reviewer runs here. */
const MACHINE = {
  version: 1,
  settings: {
    llm: { provider: "claude", model: "claude-opus-5", "api-key": "${ANTHROPIC_API_KEY}" },
    language: "en",
    "max-context-chars": 4000,
    "max-concurrent-files": 3,
  },
};

/** A repository's file: what is reviewed there, and the settings it restates. */
const REPO = {
  version: 1,
  settings: {
    language: "tr",
    llm: { model: "claude-sonnet-5" },
    exclude: ["**/*.spec.ts", "**/migrations/*.ts"],
    "max-findings-per-file": 2,
  },
  skills: {
    path: "skills",
    mappings: { "api-routes": ["src/api/**/route.ts"], models: "src/modules/**/models/*.ts" },
  },
};

/** A throwaway home and checkout for one test. */
interface Scratch {
  readonly root: string;
  /** `$XDG_CONFIG_HOME`. */
  readonly xdg: string;
  /** The machine's config home under it. */
  readonly machineDirectory: string;
  readonly machineFile: string;
  readonly machineEnvFile: string;
  /** A git checkout. */
  readonly repo: string;
  readonly repoFile: string;
  readonly repoEnvFile: string;
  /** A working directory two levels into the checkout. */
  readonly deep: string;
  /** A working directory outside any checkout. */
  readonly elsewhere: string;
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

/** Writes a file, making its directory. */
function touch(path: string, content = ""): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content, "utf8");
}

/** The bare tree: directories only, no config file written. */
function scratch(): Scratch {
  const root = temporaryRoot();
  const xdg = join(root, "home", ".config");
  const machineDirectory = join(xdg, "reviewer");
  const repo = join(root, "home", "work", "repo");
  const deep = join(repo, "src", "deep");
  const elsewhere = join(root, "elsewhere");
  for (const directory of [machineDirectory, deep, elsewhere, join(repo, ".git")]) {
    mkdirSync(directory, { recursive: true });
  }
  return {
    root,
    xdg,
    machineDirectory,
    machineFile: join(machineDirectory, "config.yaml"),
    machineEnvFile: join(machineDirectory, ".env"),
    repo,
    repoFile: join(repo, ".review", "config.yaml"),
    repoEnvFile: join(repo, ".review", ".env"),
    deep,
    elsewhere,
  };
}

/** The tree with both files written. */
function scratchWithBoth(): Scratch {
  const s = scratch();
  touch(s.machineFile, JSON.stringify(MACHINE));
  touch(s.repoFile, JSON.stringify(REPO));
  return s;
}

/** An environment that defines none of the run's settings but the essentials. */
function cleanEnvironment(s: Scratch, extra: Record<string, string> = {}): Record<string, string> {
  return {
    XDG_CONFIG_HOME: s.xdg,
    // What the machine's file names; LLM_API_KEY would be the override layer.
    ANTHROPIC_API_KEY: "llm-key",
    ...extra,
  };
}

/** The environment a run without any config file needs: the key under its own name. */
function environmentOnly(s: Scratch, extra: Record<string, string> = {}): Record<string, string> {
  return cleanEnvironment(s, { LLM_API_KEY: "llm-key", ...extra });
}

function load(
  s: Scratch,
  options: {
    /** The working directory; defaults to deep inside the checkout. */
    cwd?: string;
    configFile?: string | null;
    env?: Record<string, string>;
    overrides?: Record<string, unknown>;
    requiresModel?: boolean;
    /** Collects every line the load logs. */
    log?: string[];
  } = {},
): Config {
  return loadRunConfig({
    configFile: options.configFile ?? null,
    ...(options.overrides && { overrides: options.overrides }),
    ...(options.requiresModel !== undefined && { requiresModel: options.requiresModel }),
    ...(options.log && { logger: recordingLogger(options.log) }),
    providers: PROVIDERS,
    cpuCount: 8,
    environment: options.env ?? cleanEnvironment(s),
    cwd: options.cwd ?? s.deep,
  });
}

// -- paths -----------------------------------------------------------------

describe("configuration paths", () => {
  it("honours XDG_CONFIG_HOME and falls back to ~/.config", () => {
    expect(configHome({ XDG_CONFIG_HOME: "/xdg" })).toBe("/xdg/reviewer");
    expect(configHome({})).toBe(join(homedir(), ".config", "reviewer"));
    expect(configHome({ XDG_CONFIG_HOME: "~/cfg" })).toBe(join(homedir(), "cfg", "reviewer"));
  });

  it("always names the machine's file, and fills the repository slot from --config, REVIEWER_CONFIG, or the nearest .review/", () => {
    const s = scratch();
    touch(s.repoFile);
    const environment = { XDG_CONFIG_HOME: s.xdg };
    // The machine's path is the same whatever else is said.
    for (const paths of [
      configPaths("/explicit.yaml", { ...environment, REVIEWER_CONFIG: "/env.yaml" }, s.deep),
      configPaths(null, environment, s.deep),
      configPaths(null, environment, s.elsewhere),
    ]) {
      expect(paths.machine).toBe(s.machineFile);
    }
    // The repository slot: --config beats REVIEWER_CONFIG, and both are "named by hand".
    expect(
      configPaths("/explicit.yaml", { ...environment, REVIEWER_CONFIG: "/env.yaml" }, s.deep),
    ).toMatchObject({ repo: "/explicit.yaml", isRepoNamed: true });
    expect(
      configPaths(null, { ...environment, REVIEWER_CONFIG: "/env.yaml" }, s.deep),
    ).toMatchObject({ repo: "/env.yaml", isRepoNamed: true });
    // Otherwise the repository's own, found from any subdirectory -- the way
    // git finds its repository -- and `null` outside one.
    expect(configPaths(null, environment, s.deep)).toMatchObject({
      repo: s.repoFile,
      isRepoNamed: false,
    });
    expect(configPaths(null, environment, s.elsewhere)).toMatchObject({
      repo: null,
      isRepoNamed: false,
    });
  });

  it("does not mistake the home directory for a repository", () => {
    const s = scratch();
    const home = join(s.root, "home");
    touch(join(home, ".review", "config.yaml"));
    // The walk for `.review/config.yaml` goes through the home directory like
    // any other, so a `~/.review/` is a repository file for every checkout under it...
    expect(findRepoConfig(s.repo)).toBe(join(home, ".review", "config.yaml"));
    // ...but `init` never writes there: it asks for a git root, not a `.review/`.
    expect(findGitRoot(s.deep)).toBe(s.repo);
    expect(findGitRoot(s.elsewhere)).toBeNull();
  });

  it("takes a .git file for a repository root too, as a worktree or submodule has", () => {
    const s = scratch();
    const worktree = join(s.repo, "trees", "feature");
    touch(join(worktree, ".git"), "gitdir: ../../.git/worktrees/feature\n");
    expect(findGitRoot(join(worktree, "src"))).toBe(worktree);
  });

  it("spells a path the checkout's way when it is inside, and declines one that is not", () => {
    const s = scratch();
    expect(insideCheckout(s.repo, join(s.repo, ".review", "config.yaml"))).toBe(
      ".review/config.yaml",
    );
    expect(insideCheckout(s.repo, join(s.repo, "src", "..", "ci", "skills"))).toBe("ci/skills");
    // A sibling directory, a parent, and the checkout itself are all "not inside".
    expect(insideCheckout(s.repo, s.elsewhere)).toBeNull();
    expect(insideCheckout(s.repo, s.root)).toBeNull();
    expect(insideCheckout(s.repo, s.repo)).toBeNull();
    // A prefix match is not containment: `repo-2` is not under `repo`.
    expect(insideCheckout(s.repo, `${s.repo}-2/x`)).toBeNull();
  });
});

// -- reading on disk -------------------------------------------------------

describe("loading the config files", () => {
  it("reads both, lowest first, each knowing which home it is", () => {
    const s = scratchWithBoth();
    const files = loadConfigFiles(configPaths(null, { XDG_CONFIG_HOME: s.xdg }, s.deep), {});
    expect(files.map((file) => [file.source, file.home])).toEqual([
      [s.machineFile, "machine"],
      [s.repoFile, "repo"],
    ]);
    expect(files[1]?.values["settings"]).toMatchObject({ language: "tr" });
  });

  it("treats a missing file as no file, in either slot", () => {
    const s = scratch();
    expect(loadConfigFiles(configPaths(null, { XDG_CONFIG_HOME: s.xdg }, s.deep), {})).toEqual([]);
  });

  it("treats an explicitly named missing file as an error", () => {
    const s = scratch();
    const paths = configPaths(join(s.root, "nope.yaml"), { XDG_CONFIG_HOME: s.xdg }, s.deep);
    expect(() => loadConfigFiles(paths, {})).toThrow(/No config file/u);
  });

  it("refuses a future schema version, and names the file that is not valid YAML", () => {
    const s = scratch();
    touch(s.machineFile, JSON.stringify({ version: 99 }));
    const environment = { XDG_CONFIG_HOME: s.xdg };
    expect(() => loadConfigFiles(configPaths(null, environment, s.deep), {})).toThrow(
      /understands up to/u,
    );
    touch(s.machineFile, "llm: [unclosed");
    expect(() => loadConfigFiles(configPaths(null, environment, s.deep), {})).toThrow(
      /config\.yaml is not valid YAML/u,
    );
  });

  it("reads YAML, which JSON also is", () => {
    const s = scratch();
    touch(
      s.repoFile,
      [
        "version: 1",
        "settings:",
        "  max-findings-per-file: 1   # a comment, which JSON could not carry",
      ].join("\n"),
    );
    const [repo] = loadConfigFiles(configPaths(null, { XDG_CONFIG_HOME: s.xdg }, s.deep), {});
    expect(repo?.values["settings"]).toEqual({ "max-findings-per-file": 1 });
  });

  it("refuses skills in the machine's file, naming where they belong", () => {
    const s = scratch();
    touch(s.machineFile, JSON.stringify({ skills: { path: "~/rules" } }));
    const attempt = (): unknown =>
      loadConfigFiles(configPaths(null, { XDG_CONFIG_HOME: s.xdg }, s.deep), {});
    expect(attempt).toThrow(ConfigFileError);
    expect(attempt).toThrow(/belongs to a repository's \.review\/config\.yaml/u);
  });
});

// -- secrets ---------------------------------------------------------------

describe("secrets", () => {
  it("reads the model's key from the variable the machine's file names", () => {
    const s = scratchWithBoth();
    expect(load(s).apiKey).toBe("llm-key");
  });

  it("says which variable is missing when the key is unset", () => {
    const s = scratchWithBoth();
    const environment = cleanEnvironment(s);
    delete environment["ANTHROPIC_API_KEY"];
    expect(() => load(s, { env: environment })).toThrow(/ANTHROPIC_API_KEY/u);
  });

  it("does not demand the key the file names when the environment supplies LLM_API_KEY", () => {
    // The CI case: the workflow hands the key in as LLM_API_KEY, while a
    // config file says `api-key: ${ANTHROPIC_API_KEY}`. That variable is the
    // override layer above the files -- a run that has it has its key, and
    // the file's *name* for a different variable must not be demanded as well.
    const s = scratchWithBoth();
    const environment = cleanEnvironment(s, { LLM_API_KEY: "from-ci" });
    delete environment["ANTHROPIC_API_KEY"];
    const config = load(s, { env: environment });
    expect(config.apiKey).toBe("from-ci");
    // Everything else the files say still applies.
    expect(config.provider).toBe("claude");
    expect(config.model).toBe("claude-sonnet-5");
  });

  it("does not demand a key the file names when the flow builds no model", () => {
    // `--preview` decides scope and calls nobody; a pre-flight that refused to
    // run without a key it would never send is a pre-flight nobody can run
    // before they have one. The name is carried, the lookup is deferred.
    const s = scratchWithBoth();
    const environment = cleanEnvironment(s);
    delete environment["ANTHROPIC_API_KEY"];
    const config = load(s, { env: environment, requiresModel: false });
    expect(config.apiKey).toBe("");
    expect(config.provider).toBe("claude"); // everything else still resolves
  });

  it("finds a key placed in the machine's .env, and lets the repository's .env win over it", () => {
    const s = scratchWithBoth();
    const environment = cleanEnvironment(s);
    delete environment["ANTHROPIC_API_KEY"];
    writeFileSync(s.machineEnvFile, "ANTHROPIC_API_KEY=from-machine\n", "utf8");
    expect(load(s, { env: environment }).apiKey).toBe("from-machine");
    writeFileSync(s.repoEnvFile, "ANTHROPIC_API_KEY=from-repo\n", "utf8");
    expect(load(s, { env: environment }).apiKey).toBe("from-repo");
  });
});

// -- resolution ------------------------------------------------------------

describe("the repository's file on top of the machine's", () => {
  it("takes what the repository restates from the repository, and the rest from the machine", () => {
    const s = scratchWithBoth();
    const config = load(s);
    // Restated in the repository's file.
    expect(config.reviewLang).toBe("Turkish");
    expect(config.excludeGlobs).toEqual(["**/*.spec.ts", "**/migrations/*.ts"]);
    expect(config.maxFindingsPerFile).toBe(2);
    // Said only in the machine's.
    expect(config.maxContextChars).toBe(4000);
    expect(config.concurrency()).toEqual({ files: 3 });
    // Said in neither: the built-in default.
    expect(config.maxSkillChars).toBe(10_000);
  });

  it("merges llm key by key, so a repository pins the model and keeps the machine's provider and key", () => {
    const s = scratchWithBoth();
    const config = load(s);
    expect(config.provider).toBe("claude");
    expect(config.llmSettings()).toEqual({
      apiKey: "llm-key", // ANTHROPIC_API_KEY, named in the machine's file
      baseUrl: null,
      model: "claude-sonnet-5", // the repository's
    });
  });

  it("carries the skills map, one bare glob becoming a list, the path anchored beside the repository's file", () => {
    const s = scratchWithBoth();
    expect(load(s).skillSettings()).toEqual({
      path: join(s.repo, ".review", "skills"),
      defaults: [],
      mappings: { "api-routes": ["src/api/**/route.ts"], models: ["src/modules/**/models/*.ts"] },
    });
  });

  it("leaves an anchored skills path alone, and does not re-anchor the environment's", () => {
    const s = scratchWithBoth();
    touch(s.repoFile, JSON.stringify({ skills: { path: "~/rules" } }));
    expect(load(s).skillSettings().path).toBe("~/rules");
    // The environment's path comes from no file, so the checkout is its natural base.
    const fromEnvironment = load(s, { env: cleanEnvironment(s, { REVIEW_SKILLS_PATH: "rules" }) });
    expect(fromEnvironment.skillSettings().path).toBe("rules");
  });

  it("runs on the machine's file alone outside a checkout that carries .review/", () => {
    const s = scratchWithBoth();
    const config = load(s, { cwd: s.elsewhere });
    expect(config.provider).toBe("claude");
    expect(config.model).toBe("claude-opus-5");
    expect(config.reviewLang).toBe("English");
    expect(config.skillSettings()).toEqual({ path: "", defaults: [], mappings: {} });
  });

  it("runs on the repository's file alone when the machine has none", () => {
    const s = scratch();
    touch(
      s.repoFile,
      JSON.stringify({
        ...REPO,
        settings: { ...REPO.settings, llm: { provider: "local", "api-key": "lm-studio" } },
      }),
    );
    const config = load(s);
    expect(config.provider).toBe("local");
    expect(config.apiKey).toBe("lm-studio"); // not spelled like a variable: the key itself
    expect(config.reviewLang).toBe("Turkish");
  });

  it("lets --config stand in for the repository's file, with the machine's still underneath", () => {
    const s = scratchWithBoth();
    const other = join(s.root, "other", "config.yaml");
    touch(other, JSON.stringify({ settings: { language: "tr" }, skills: { path: "rules" } }));
    const config = load(s, { configFile: other, cwd: s.elsewhere });
    expect(config.reviewLang).toBe("Turkish");
    expect(config.provider).toBe("claude"); // from the machine's file
    expect(config.skillSettings().path).toBe(join(s.root, "other", "rules"));
  });

  it("reports an unrecognised setting rather than ignoring it, in either file", () => {
    const s = scratch();
    touch(s.machineFile, JSON.stringify({ settings: { exlude: ["*.md"] } }));
    expect(() => load(s)).toThrow(/'settings\.exlude' not declared in the schema/u);
    touch(s.machineFile, JSON.stringify(MACHINE));
    touch(s.repoFile, JSON.stringify({ settings: { "local-path": "~/src/x" } }));
    expect(() => load(s)).toThrow(/'settings\.local-path' not declared in the schema/u);
    // A setting at the root is pointed to the section rather than merely refused.
    touch(s.repoFile, JSON.stringify({ language: "tr" }));
    expect(() => load(s)).toThrow(/at the root; a setting goes under the settings section/u);
  });
});

describe("settings that disagree with each other", () => {
  it("warns once the whole configuration is in hand, without refusing the run", () => {
    // Each cap is legal, so validation passes; together they mean a file's
    // block can hold one skill and no more.
    const s = scratchWithBoth();
    const log: string[] = [];
    const config = load(s, {
      env: cleanEnvironment(s, {
        REVIEW_MAX_SKILL_CHARS: "20000",
        REVIEW_MAX_SKILLS_TOTAL_CHARS: "18000",
      }),
      log,
    });
    expect(config.maxSkillChars).toBe(20_000);
    expect(log.filter((line) => line.startsWith("WARNING"))).toEqual([
      "WARNING settings.max-skill-chars=20000 is larger than settings.max-skills-total-chars=18000: one long skill can fill a file's whole block, leaving every other skill that matches it out of the prompt. Raise the block cap, or lower the per-skill one.",
    ]);
  });

  it("says nothing when they agree", () => {
    const s = scratchWithBoth();
    const log: string[] = [];
    load(s, { log });
    expect(log.filter((line) => line.startsWith("WARNING"))).toEqual([]);
  });
});

describe("the environment and the command line", () => {
  it("reads the skills map from the environment as JSON, which beats the files", () => {
    const s = scratchWithBoth();
    const config = load(s, {
      env: cleanEnvironment(s, { REVIEW_SKILL_MAPPINGS: '{"models": [" a/** ", ""]}' }),
    });
    expect(config.skillSettings().mappings).toEqual({ models: ["a/**"] });
  });

  it("reads no skills baseline from the environment: skills.defaults is the repository file's alone", () => {
    // A repository's baseline is part of that repository; a shell variable of a would-be name is
    // not a setting the schema knows, and is ignored like any other.
    const s = scratchWithBoth();
    const config = load(s, {
      env: cleanEnvironment(s, {
        REVIEW_SKILL_DEFAULTS: '[{"globs": "**/*.ts", "skills": "typescript-base"}]',
      }),
    });
    expect(config.skillSettings().defaults).toEqual([]);
  });

  it("refuses a skills map that is not an object", () => {
    const s = scratchWithBoth();
    const attempt = (): Config =>
      load(s, { env: cleanEnvironment(s, { REVIEW_SKILL_MAPPINGS: "not json" }) });
    expect(attempt).toThrow(ConfigError);
    // convict names the setting by its place in the file, whatever alias set it.
    expect(attempt).toThrow(/skills\.mappings: must be an object/u);
  });

  it("lets the environment override both files", () => {
    const s = scratchWithBoth();
    const config = load(s, { env: cleanEnvironment(s, { REVIEW_LANG: "en", LLM_MODEL: "m" }) });
    // The repository says Turkish and claude-sonnet-5; the environment outranks it.
    expect(config.reviewLang).toBe("English");
    expect(config.model).toBe("m");
  });

  it("treats an empty environment variable as unset, not as an override", () => {
    // `REVIEW_SKILLS_PATH=` in a shell, or a CI input left blank and exported
    // anyway, is not an instruction to disable skills: it must fall through
    // to the files the way an unset variable does. Otherwise a repository's
    // own .review/config.yaml is silently overridden by nothing.
    const s = scratchWithBoth();
    const config = load(s, {
      env: cleanEnvironment(s, { REVIEW_SKILLS_PATH: "", REVIEW_LANG: "  " }),
    });
    expect(config.skillSettings().path).toBe(join(s.repo, ".review", "skills"));
    expect(config.reviewLang).toBe("Turkish");
  });

  it("lets a .env file override the files too", () => {
    const s = scratchWithBoth();
    writeFileSync(join(s.deep, ".env"), "REVIEW_LANG=en\n", "utf8");
    expect(load(s).reviewLang).toBe("English");
  });

  it("ranks the repository's .env above the machine's above the working directory's", () => {
    // The repository's .env sits beside its config.yaml, so it is found only when that file is.
    const s = scratchWithBoth();
    writeFileSync(join(s.deep, ".env"), "REVIEW_LANG=en\nREVIEW_SKILLS_PATH=from-cwd\n", "utf8");
    writeFileSync(s.machineEnvFile, "REVIEW_LANG=tr\nREVIEW_MAX_CONTEXT_CHARS=1\n", "utf8");
    touch(s.repoEnvFile, "REVIEW_MAX_CONTEXT_CHARS=2\n");
    const config = load(s, { env: environmentOnly(s) });
    expect(config.reviewLang).toBe("Turkish");
    expect(config.skillsPath).toBe("from-cwd");
    expect(config.maxContextChars).toBe(2);
  });

  it("lets the real environment override every .env file", () => {
    const s = scratch();
    writeFileSync(s.machineEnvFile, "REVIEW_LANG=tr\n", "utf8");
    expect(load(s, { env: environmentOnly(s, { REVIEW_LANG: "en" }) }).reviewLang).toBe("English");
  });

  it("lets the command line override the environment", () => {
    const s = scratchWithBoth();
    const config = load(s, {
      env: cleanEnvironment(s, { REVIEW_LANG: "en" }),
      overrides: { reviewLang: "tr" },
    });
    expect(config.reviewLang).toBe("Turkish");
  });

  it("configures the run from the environment alone without any file", () => {
    const s = scratch();
    const config = load(s, { env: environmentOnly(s, { REVIEW_LANG: "tr" }) });
    expect(config.provider).toBe("local");
    expect(config.reviewLang).toBe("Turkish");
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
    skills_path: config.skillsPath,
    max_skill_chars: config.maxSkillChars,
    max_skills_total_chars: config.maxSkillsTotalChars,
    max_context_chars: config.maxContextChars,
    max_findings_per_file: config.maxFindingsPerFile,
    verify_findings: config.verifyFindings,
    review_lang: config.reviewLang,
    exclude_globs: config.excludeGlobs,
    max_concurrent_files: config.maxConcurrentFiles,
  };
}

interface SchemaInput {
  env: Record<string, string>;
  cpu: number;
}

function build(input: SchemaInput): Config {
  return buildConfig({ environment: input.env, providers: PROVIDERS, cpuCount: input.cpu });
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

  // convict's validation report is this implementation's ConfigError; each
  // line names the setting's path in the file, whatever alias set it.
  it.each(schemaCases.filter((c) => isErrorContract(c.expected)))("config/$name", ({ input }) => {
    const attempt = (): Config => build(input);
    expect(attempt).toThrow(ConfigError);
    expect(attempt).toThrow(/^settings\./u);
  });

  it("demands the model's key, unless the flow builds no model", () => {
    const environment = { LLM_PROVIDER: "local" };
    expect(() => buildConfig({ environment, providers: PROVIDERS, cpuCount: 4 })).toThrow(
      ConfigError,
    );
    // `--preview` resolves the same configuration but calls nobody, so the
    // key it would never send is not a reason to refuse the run.
    const config = buildConfig({
      environment,
      providers: PROVIDERS,
      cpuCount: 4,
      requiresModel: false,
    });
    expect(config.llmSettings().apiKey).toBe("");
    // Everything else about the model is still validated.
    expect(() =>
      buildConfig({
        environment: { LLM_PROVIDER: "nonesuch" },
        providers: PROVIDERS,
        cpuCount: 4,
        requiresModel: false,
      }),
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
