/**
 * Resolves one run's configuration from every layer: command line › environment › catalogue project › default.
 * Pure: the environment, `.env` contents and catalogue arrive as parameters.
 * @packageDocumentation
 */

import { type Catalog, type ProjectSettings } from "../catalog/catalog";
import {
  LLM_SECTION_KEYS,
  type LlmSectionKey,
  PROJECT_SETTING_KEYS,
  type ProjectSettingKey,
  SKILLS_SECTION_KEYS,
  type SkillsSectionKey,
} from "../catalog/schema";
import { type Logger, NULL_LOGGER } from "../ports/logger";
import { CatalogError } from "../util/errors";
import { isPlainObject } from "../util/json";
import { show } from "../util/text";

import {
  CONFIG_ALIASES,
  type Config,
  type ConfigField,
  type ConfigOptions,
  aliasOf,
  buildConfig,
} from "./config";
import { resolveSecret } from "./secret";

/** Scalar catalogue keys → `Config` fields. */
export const PROJECT_FIELDS: Readonly<
  Record<Exclude<ProjectSettingKey, "skills" | "llm">, ConfigField>
> = {
  language: "reviewLang",
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

/** The `llm` section → model fields. */
const LLM_FIELDS: Readonly<Record<LlmSectionKey, ConfigField>> = {
  provider: "provider",
  model: "model",
  "base-url": "baseUrl",
  "api-key": "apiKey",
};

/** The placeholder a shared path may carry for the project's name. */
const PROJECT_PLACEHOLDER = "{{project}}";

/** Spells `{{project}}` out in a path. */
function withProjectName(path: string, name: string): string {
  return path.replaceAll(PROJECT_PLACEHOLDER, () => name);
}

/** Whether a path names a place on its own: absolute, or under `~`. */
function isAnchored(path: string): boolean {
  return path.startsWith("/") || path === "~" || path.startsWith("~/");
}

/** Anchors a catalogue's relative path to the catalogue's own directory. */
function besideCatalog(path: string, catalogDirectory: string): string {
  const trimmed = path.trim();
  return trimmed === "" || isAnchored(trimmed)
    ? trimmed
    : `${catalogDirectory.replace(/\/+$/u, "")}/${trimmed.replace(/^\.\//u, "")}`;
}

/** The `skills` section → two fields. */
const SKILLS_FIELDS: Readonly<Record<SkillsSectionKey, ConfigField>> = {
  path: "skillsPath",
  mappings: "skillMappings",
};

/** Fields the file may set as a list but the schema reads as CSV. */
const LIST_FIELDS: ReadonlySet<ConfigField> = new Set(["excludePaths"]);

/** Name/value pairs from one source; names are matched case-insensitively. */
export type EnvironmentValues = Readonly<Record<string, string | undefined>>;

/** The environment layers. */
export interface ConfigSources {
  /** The real process environment. */
  readonly processEnv: EnvironmentValues;
  /** The `.env` files' contents, lowest precedence first. */
  readonly envFiles: readonly EnvironmentValues[];
}

/** What {@link resolveConfig} needs. */
export interface ResolveOptions extends ConfigOptions {
  /** The parsed catalogue, or `null` when there is no file. */
  readonly catalog: Catalog | null;
  /** The catalogue's directory; the base for every relative path it names. Defaults to `configHome`. */
  readonly catalogDirectory?: string;
  /** `--project`, or `null` to pick the only project / run without one. */
  readonly project: string | null;
  /** Command-line settings by field; they outrank every other layer. */
  readonly overrides?: Readonly<Partial<Record<ConfigField, unknown>>>;
  readonly sources: ConfigSources;
  /** Where `config.yaml` and its sibling `.env` live, for messages. */
  readonly configHome: string;
  readonly logger?: Logger;
}

/** The uppercased aliases the environment supplies, so a project value cannot shadow them. */
function suppliedAliases(sources: ConfigSources): Set<string> {
  const supplied = new Set<string>();
  for (const source of [sources.processEnv, ...sources.envFiles]) {
    for (const [name, value] of Object.entries(source)) {
      if (isSet(value)) supplied.add(name.toUpperCase());
    }
  }
  return supplied;
}

/** Whether an environment value counts as said; `""` does not. */
function isSet(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== "";
}

/** The environment as one alias-keyed map: `.env` files lowest first, the process environment on top. */
function mergedEnvironment(sources: ConfigSources): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const source of [...sources.envFiles, sources.processEnv]) {
    for (const [name, value] of Object.entries(source)) {
      if (isSet(value)) merged[name.toUpperCase()] = value;
    }
  }
  return merged;
}

/** What {@link projectValues} needs. */
export interface ProjectValuesOptions {
  readonly catalog: Catalog;
  /** `--project`, or `null` to pick the only project. */
  readonly project: string | null;
  /** The catalogue's directory; the base for every relative path it names. */
  readonly catalogDirectory: string;
  /** The merged environment, for resolving a named secret. */
  readonly environment: Readonly<Record<string, string>>;
  /** Where `config.yaml` and its sibling `.env` live, for messages. */
  readonly configHome: string;
  /** `false` for a flow that builds no model, so a named key is not demanded. */
  readonly requiresModel?: boolean;
  /** Whether the environment already supplies `LLM_API_KEY`, answering the catalogue's name. */
  readonly hasApiKey?: boolean;
  readonly logger?: Logger;
}

/** Field values as they accumulate. */
type Values = Partial<Record<ConfigField, unknown>>;

/** The scalar settings of a project; lists become CSV. */
function flattenedSettings(settings: ProjectSettings): Values {
  const values: Values = {};
  for (const key of PROJECT_SETTING_KEYS) {
    if (key === "skills" || key === "llm" || !Object.hasOwn(settings, key)) continue;
    const field = PROJECT_FIELDS[key];
    const raw = settings[key];
    values[field] = LIST_FIELDS.has(field) && Array.isArray(raw) ? raw.map(String).join(",") : raw;
  }
  return values;
}

/** The `skills` section as field values. */
function skillsValues(settings: ProjectSettings): Values {
  const skills = isPlainObject(settings.skills) ? settings.skills : {};
  const values: Values = {};
  for (const key of SKILLS_SECTION_KEYS) {
    if (Object.hasOwn(skills, key)) values[SKILLS_FIELDS[key]] = skills[key];
  }
  return values;
}

/** What resolving the model's key needs to know about this run. */
interface SecretContext {
  readonly environment: Readonly<Record<string, string>>;
  readonly configHome: string;
  /** Whether an unset named variable is an error. */
  readonly requiresModel: boolean;
  /** Whether `LLM_API_KEY` is already supplied. */
  readonly hasApiKey: boolean;
}

/** The `llm` section as field values; `api-key` is resolved as a secret. */
function llmValues(settings: ProjectSettings, secret: SecretContext): Values {
  const llm = isPlainObject(settings.llm) ? settings.llm : {};
  const values: Values = {};
  for (const key of LLM_SECTION_KEYS) {
    if (!Object.hasOwn(llm, key)) continue;
    const raw = llm[key];
    values[LLM_FIELDS[key]] =
      key === "api-key" && typeof raw === "string"
        ? resolveSecret(
            raw,
            secret.environment,
            "llm.api-key",
            `${secret.configHome}/.env`,
            secret.requiresModel && !secret.hasApiKey,
          )
        : raw;
  }
  return values;
}

/** Spells `{{project}}` out in the paths that may carry it. */
function withProjectPlaceholders(values: Values, projectName: string): Values {
  const out: Values = { ...values };
  for (const field of ["skillsPath", "localPath"] as const) {
    const path = out[field];
    if (typeof path === "string") out[field] = withProjectName(path, projectName);
  }
  return out;
}

/** Anchors the catalogue's relative paths (today: `skills.path`) to its directory. */
function withAnchoredPaths(values: Values, catalogDirectory: string): Values {
  const anchored: Values = { ...values };
  if (typeof anchored.skillsPath === "string") {
    anchored.skillsPath = besideCatalog(anchored.skillsPath, catalogDirectory);
  }
  return anchored;
}

/**
 * Flattens one project into `Config` field values.
 *
 * @returns Settings, skills and model values, with placeholders spelled out and paths anchored.
 * @throws {@link CatalogError} when the project is unknown or a required named secret is unset.
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
}: ProjectValuesOptions): Values {
  const spec = catalog.project(project);
  const settings = catalog.settingsFor(spec);
  const merged: Values = {
    ...flattenedSettings(settings),
    ...skillsValues(settings),
    ...llmValues(settings, { environment, configHome, requiresModel, hasApiKey }),
  };
  const values = withAnchoredPaths(withProjectPlaceholders(merged, spec.name), catalogDirectory);

  const where = typeof values.localPath === "string" ? values.localPath : "the current directory";
  logger.child("config_resolver").info(`Project ${show(spec.name)}: reviewing ${where}.`);
  return values;
}

/**
 * Resolves one run's configuration from every layer.
 *
 * @returns The validated `Config`. Without a catalogue, the environment alone describes the run.
 * @throws {@link CatalogError} when `--project` is given without a catalogue.
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
      `--project ${show(project)} needs a catalogue, but none was found at ${options.configHome}/config.yaml. Run 'reviewer init' to create one.`,
    );
  }

  const values: Record<string, unknown> = { ...environment };
  const layered = Object.entries({ ...fromProject, ...options.overrides });
  for (const [field, value] of layered) {
    values[CONFIG_ALIASES[field as ConfigField]] = value;
  }
  return buildConfig(values, {
    providers: options.providers,
    cpuCount: options.cpuCount,
    ...(options.requiresModel !== undefined && { requiresModel: options.requiresModel }),
  });
}
