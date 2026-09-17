/**
 * Resolving one run's configuration from every layer that may speak.
 *
 * Four layers, highest precedence first: the command line, the environment
 * (real variables and the `.env` files alike), the `config.json` project
 * entry, and the field default. They collapse into one flat `Config`, so
 * nothing below this module knows a catalogue exists.
 *
 * This module is pure: the process environment, the `.env` files' contents
 * and the catalogue arrive as parameters, already read. That is what lets the
 * precedence rule be tested without touching a disk or the real environment.
 */

import {
  type Catalog,
  LLM_SECTION_KEYS,
  type LlmSectionKey,
  PROJECT_SETTING_KEYS,
  type ProjectSettingKey,
  SKILLS_SECTION_KEYS,
  type SkillsSectionKey,
  resolveSecret,
} from "../catalog/catalog";
import { type Logger, NULL_LOGGER } from "../ports/logger";
import { CatalogError } from "../util/errors";
import { isDict, pyRepr } from "../util/py";

import {
  CONFIG_ALIASES,
  type Config,
  type ConfigField,
  type ConfigOptions,
  aliasOf,
  buildConfig,
} from "./config";

/** Catalogue setting keys -> `Config` fields (the two sections are mapped below). */
export const PROJECT_FIELDS: Readonly<
  Record<Exclude<ProjectSettingKey, "skills" | "llm">, ConfigField>
> = {
  language: "reviewLang",
  prompts: "promptFiles",
  verify: "verifyFindings",
  "local-path": "localPath",
  exclude: "excludePaths",
  "max-findings-per-file": "maxFindingsPerFile",
  "max-file-chars": "maxFileChars",
  "max-skill-chars": "maxSkillChars",
  "max-skills-total-chars": "maxSkillsTotalChars",
  "max-context-chars": "maxContextChars",
  "max-concurrent-files": "maxConcurrentFiles",
};

/** The `llm` section onto the model fields; `api-key` is a secret (see below). */
const LLM_FIELDS: Readonly<Record<LlmSectionKey, ConfigField>> = {
  provider: "provider",
  model: "modelName",
  "base-url": "baseUrl",
  "api-key": "apiKey",
};

/** The placeholder a shared path may carry for the project's name. */
const PROJECT_PLACEHOLDER = "{{project}}";

/** A catalogue path with `{{project}}` spelled out. */
function withProjectName(path: string, name: string): string {
  return path.replaceAll(PROJECT_PLACEHOLDER, () => name);
}

/** Whether a path already names a place on its own: absolute, or under `~`. */
function isAnchored(path: string): boolean {
  return path.startsWith("/") || path === "~" || path.startsWith("~/");
}

/**
 * A catalogue's relative path, anchored to the catalogue's own directory.
 *
 * One rule for every path the catalogue names: `prompts/system.md` and
 * `skills/` both mean "beside this file". A repository's `.review/config.yaml`
 * therefore says `skills: { path: skills }`, the machine's says
 * `skills/{{project}}`, and neither has to know where the reviewed checkout
 * is. Paths from the environment or the command line are not touched here:
 * they come from no file, so the checkout is their natural base.
 */
function besideCatalog(path: string, catalogDirectory: string): string {
  const trimmed = path.trim();
  return trimmed === "" || isAnchored(trimmed)
    ? trimmed
    : `${catalogDirectory.replace(/\/+$/u, "")}/${trimmed.replace(/^\.\//u, "")}`;
}

/** The project's `skills` section: `{ path, mappings }` onto two fields. */
const SKILLS_FIELDS: Readonly<Record<SkillsSectionKey, ConfigField>> = {
  path: "skillsPath",
  mappings: "skillMappings",
};

/** Fields the file may set as a list but the review layer reads as a CSV string. */
const LIST_FIELDS: ReadonlySet<ConfigField> = new Set(["excludePaths"]);

/** Name/value pairs from one source; names are matched case-insensitively. */
export type EnvironmentValues = Readonly<Record<string, string | undefined>>;

export interface ConfigSources {
  /** The real process environment. */
  readonly processEnv: EnvironmentValues;
  /** The `.env` files' contents, lowest precedence first. */
  readonly envFiles: readonly EnvironmentValues[];
}

export interface ResolveOptions extends ConfigOptions {
  /** The parsed catalogue, or `null` when there is no file. */
  readonly catalog: Catalog | null;
  /** The catalogue file's directory; the base for every relative path it names. */
  readonly catalogDirectory?: string;
  /** `--project`, or `null` to pick the only project / run without one. */
  readonly project: string | null;
  /** Command-line settings by field name; they outrank every other layer. */
  readonly overrides?: Readonly<Partial<Record<ConfigField, unknown>>>;
  readonly sources: ConfigSources;
  /** Where `config.json` and its sibling `.env` live, for error messages. */
  readonly configHome: string;
  readonly logger?: Logger;
}

/**
 * Environment names the environment supplies, real vars and `.env` alike,
 * uppercased for comparison.
 *
 * Needed because the catalogue sits *below* the environment in precedence. A
 * project value must not shadow a variable the environment already sets, so
 * the aliases the environment covers are dropped from the project's values.
 */
function suppliedAliases(sources: ConfigSources): Set<string> {
  const supplied = new Set<string>();
  for (const source of [sources.processEnv, ...sources.envFiles]) {
    for (const [name, value] of Object.entries(source)) {
      if (isSet(value)) supplied.add(name.toUpperCase());
    }
  }
  return supplied;
}

/**
 * Whether an environment value counts as *said*.
 *
 * An empty variable does not. `REVIEW_SKILLS_PATH=` in a shell, or a CI
 * input left blank and exported anyway, is not an instruction to disable
 * skills -- it is the absence of one, and must fall through to the project
 * the way an unset variable does. The command line is different: a typed
 * `--skills-path ""` is a deliberate statement and is handled as one there.
 */
function isSet(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== "";
}

/**
 * The environment as one alias-keyed map: `.env` files lowest first, then the
 * real environment on top. This is the order the settings loader reads them
 * in, and the order an `llm.api-key` lookup must honour as well.
 */
function mergedEnvironment(sources: ConfigSources): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const source of [...sources.envFiles, sources.processEnv]) {
    for (const [name, value] of Object.entries(source)) {
      if (isSet(value)) merged[name.toUpperCase()] = value;
    }
  }
  return merged;
}

export interface ProjectValuesOptions {
  readonly catalog: Catalog;
  /** `--project`, or `null` to pick the only project. */
  readonly project: string | null;
  /**
   * The directory the catalogue file is in. Every relative path the
   * catalogue names is taken from here, so `prompts` and `skills.path` share
   * one base and a reader can check either against the other.
   */
  readonly catalogDirectory: string;
  /** The merged environment the settings loader also reads. */
  readonly environment: Readonly<Record<string, string>>;
  /** Where `config.json` and its sibling `.env` live, for error messages. */
  readonly configHome: string;
  /**
   * False for a flow that builds no model (`--preview`), so a key the
   * catalogue *names* is not demanded of an environment that lacks it. The
   * name is still carried through; only the lookup is deferred to the run
   * that will actually send it.
   */
  readonly requiresModel?: boolean;
  /**
   * True when the environment already supplies `LLM_API_KEY`.
   *
   * That variable is the override layer above the catalogue, so a run that
   * has it has its key: the catalogue's `llm.api-key` -- which *names* a
   * different variable -- is answered and must not be demanded as well. This
   * is how a CI job hands the key in under one name while a repository's
   * committed config names another.
   */
  readonly hasApiKey?: boolean;
  readonly logger?: Logger;
}

/**
 * One project flattened into `Config` field values.
 *
 * Also where the model's key is read, from the same merged environment the
 * settings see, so a key placed in the `.env` beside the catalogue is found.
 */
export function projectValues({
  catalog,
  project,
  catalogDirectory,
  environment,
  configHome,
  requiresModel = true,
  hasApiKey = false,
  logger = NULL_LOGGER,
}: ProjectValuesOptions): Partial<Record<ConfigField, unknown>> {
  const spec = catalog.project(project);
  const values: Partial<Record<ConfigField, unknown>> = {};
  // The project's settings over the catalogue's `defaults`.
  const settings = catalog.settingsFor(spec);
  for (const key of PROJECT_SETTING_KEYS) {
    if (key === "skills" || key === "llm" || !Object.hasOwn(settings, key)) continue;
    const field = PROJECT_FIELDS[key];
    const raw = settings[key];
    values[field] = LIST_FIELDS.has(field) && Array.isArray(raw) ? raw.map(String).join(",") : raw;
  }
  // `skills` is one section in the file and two settings in the run.
  const skills = isDict(settings.skills) ? settings.skills : {};
  for (const key of SKILLS_SECTION_KEYS) {
    if (Object.hasOwn(skills, key)) values[SKILLS_FIELDS[key]] = skills[key];
  }
  // `llm`: the model knobs; the key may be named (an environment variable) or given.
  const llm = isDict(settings.llm) ? settings.llm : {};
  for (const key of LLM_SECTION_KEYS) {
    if (!Object.hasOwn(llm, key)) continue;
    const raw = llm[key];
    values[LLM_FIELDS[key]] =
      key === "api-key" && typeof raw === "string"
        ? resolveSecret(
            raw,
            environment,
            "llm.api-key",
            `${configHome}/.env`,
            requiresModel && !hasApiKey,
          )
        : raw;
  }
  // A shared path may name the project's own folder: `skills/{{project}}`.
  for (const field of ["skillsPath", "localPath"] as const) {
    const path = values[field];
    if (typeof path === "string") values[field] = withProjectName(path, spec.name);
  }
  // The catalogue's skills directory is beside the catalogue, like its
  // prompts -- so a relative path is anchored here, once, and the flow that
  // reads it never has to ask which base a path meant.
  if (typeof values.skillsPath === "string") {
    values.skillsPath = besideCatalog(values.skillsPath, catalogDirectory);
  }
  if (Array.isArray(values.promptFiles)) {
    values.promptFiles = values.promptFiles.map((file: unknown) =>
      typeof file === "string" ? withProjectName(file, spec.name) : file,
    );
  }
  const where = typeof values.localPath === "string" ? values.localPath : "the current directory";
  logger.child("config_resolver").info(`Project ${pyRepr(spec.name)}: reviewing ${where}.`);
  return values;
}

/**
 * Resolve one run's configuration from every layer that may speak.
 *
 * With no catalogue the run proceeds on the environment alone -- a single
 * implicit project -- which is how a catalogue-less setup works.
 */
export function resolveConfig(options: ResolveOptions): Config {
  const { catalog, project, sources } = options;
  const environment = mergedEnvironment(sources);

  let fromProject: Partial<Record<ConfigField, unknown>> = {};
  if (catalog !== null) {
    const supplied = suppliedAliases(sources);
    const all = projectValues({
      catalog,
      project,
      catalogDirectory: options.catalogDirectory ?? options.configHome,
      environment,
      configHome: options.configHome,
      hasApiKey: supplied.has(CONFIG_ALIASES.apiKey),
      ...(options.requiresModel !== undefined && { requiresModel: options.requiresModel }),
      ...(options.logger && { logger: options.logger }),
    });
    fromProject = Object.fromEntries(
      Object.entries(all).filter(([field]) => !supplied.has(aliasOf(field as ConfigField))),
    );
  } else if (project !== null && project !== "") {
    throw new CatalogError(
      `--project ${pyRepr(project)} needs a catalogue, but none was found at ${options.configHome}/config.yaml. Run 'reviewer init' to create one.`,
    );
  }

  // Alias-keyed values in precedence order: environment, then the project's
  // values the environment did not cover, then the command line on top.
  const values: Record<string, unknown> = { ...environment };
  const layered = Object.entries({ ...fromProject, ...options.overrides });
  for (const [field, value] of layered) {
    values[CONFIG_ALIASES[field as ConfigField]] = value;
  }
  return buildConfig(values, {
    providerNames: options.providerNames,
    cpuCount: options.cpuCount,
    ...(options.requiresModel !== undefined && { requiresModel: options.requiresModel }),
  });
}
