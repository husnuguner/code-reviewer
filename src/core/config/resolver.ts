/**
 * Resolves one run's configuration from every layer: command line › environment › repository file › machine file
 * › default. Pure: the environment, `.env` contents and config files arrive as parameters.
 * @packageDocumentation
 */

import { type ConfigFile, type SettingValues, layerSettings } from "../config/config-file";
import { type Logger, NULL_LOGGER } from "../ports/logger";
import { isPlainObject } from "../util/json";

import {
  CONFIG_ALIASES,
  type Config,
  type ConfigField,
  type ConfigOptions,
  aliasOf,
  buildConfig,
} from "./config";
import {
  LLM_SECTION_KEYS,
  type LlmSectionKey,
  SETTING_KEYS,
  type SettingKey,
  SKILLS_SECTION_KEYS,
  type SkillsSectionKey,
} from "./schema";
import { resolveSecret } from "./secret";

/** Scalar setting keys → `Config` fields. */
export const SETTING_FIELDS: Readonly<Record<Exclude<SettingKey, "skills" | "llm">, ConfigField>> =
  {
    language: "reviewLang",
    verify: "verifyFindings",
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

/** The `skills` section → two fields. */
const SKILLS_FIELDS: Readonly<Record<SkillsSectionKey, ConfigField>> = {
  path: "skillsPath",
  mappings: "skillMappings",
};

/** Fields the file may set as a list but the schema reads as CSV. */
const LIST_FIELDS: ReadonlySet<ConfigField> = new Set(["excludePaths"]);

/** Whether a path names a place on its own: absolute, or under `~`. */
function isAnchored(path: string): boolean {
  return path.startsWith("/") || path === "~" || path.startsWith("~/");
}

/** Anchors a config file's relative path to the file's own directory. */
function besideFile(path: string, directory: string): string {
  const trimmed = path.trim();
  return trimmed === "" || isAnchored(trimmed)
    ? trimmed
    : `${directory.replace(/\/+$/u, "")}/${trimmed.replace(/^\.\//u, "")}`;
}

/** Name/value pairs from one source; names are matched case-insensitively. */
export type EnvironmentValues = Readonly<Record<string, string | undefined>>;

/** The environment layers. */
export interface ConfigSources {
  /** The real process environment. */
  readonly processEnv: EnvironmentValues;
  /** The `.env` files' contents, lowest precedence first. */
  readonly envFiles: readonly EnvironmentValues[];
}

/** The config files a run found, each `null` when absent. */
export interface ConfigFiles {
  readonly machine: ConfigFile | null;
  readonly repo: ConfigFile | null;
}

/** What {@link resolveConfig} needs. */
export interface ResolveOptions extends ConfigOptions {
  readonly files: ConfigFiles;
  /** Command-line settings by field; they outrank every other layer. */
  readonly overrides?: Readonly<Partial<Record<ConfigField, unknown>>>;
  readonly sources: ConfigSources;
  /** Where the machine's `config.yaml` and its sibling `.env` live, for messages. */
  readonly configHome: string;
  readonly logger?: Logger;
}

/** The uppercased aliases the environment supplies, so a file value cannot shadow them. */
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

/** Field values as they accumulate. */
type Values = Partial<Record<ConfigField, unknown>>;

/** The scalar settings; lists become CSV. */
function flattenedSettings(settings: SettingValues): Values {
  const values: Values = {};
  for (const key of SETTING_KEYS) {
    if (key === "skills" || key === "llm" || !Object.hasOwn(settings, key)) continue;
    const field = SETTING_FIELDS[key];
    const raw = settings[key];
    values[field] = LIST_FIELDS.has(field) && Array.isArray(raw) ? raw.map(String).join(",") : raw;
  }
  return values;
}

/** The `skills` section as field values; a relative `path` is anchored beside the file that set it. */
function skillsValues(settings: SettingValues, directory: string): Values {
  const skills = isPlainObject(settings.skills) ? settings.skills : {};
  const values: Values = {};
  for (const key of SKILLS_SECTION_KEYS) {
    if (Object.hasOwn(skills, key)) values[SKILLS_FIELDS[key]] = skills[key];
  }
  if (typeof values.skillsPath === "string") {
    values.skillsPath = besideFile(values.skillsPath, directory);
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
function llmValues(settings: SettingValues, secret: SecretContext): Values {
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

/** What {@link fileValues} needs. */
export interface FileValuesOptions {
  readonly files: ConfigFiles;
  /** The merged environment, for resolving a named secret. */
  readonly environment: Readonly<Record<string, string>>;
  /** Where the machine's `config.yaml` and its sibling `.env` live, for messages. */
  readonly configHome: string;
  /** `false` for a flow that builds no model, so a named key is not demanded. */
  readonly requiresModel?: boolean;
  /** Whether the environment already supplies `LLM_API_KEY`, answering the file's name. */
  readonly hasApiKey?: boolean;
  readonly logger?: Logger;
}

/** The directory a config file lives in: the base for its relative paths. */
function directoryOf(file: ConfigFile): string {
  const index = file.source.lastIndexOf("/");
  return index <= 0 ? "." : file.source.slice(0, index);
}

/**
 * Flattens the config files into `Config` field values, the repository's on top of the machine's.
 *
 * @returns Settings, skills and model values, with relative paths anchored beside the file that set them.
 * @throws {@link ConfigFileError} when a required named secret is unset.
 */
export function fileValues({
  files,
  environment,
  configHome,
  requiresModel = true,
  hasApiKey = false,
  logger = NULL_LOGGER,
}: FileValuesOptions): Values {
  const settings = layerSettings(files.machine?.values ?? null, files.repo?.values ?? null);
  // `skills` is repository-only, so its relative path is anchored beside the repository's file.
  const skillsDirectory = files.repo === null ? configHome : directoryOf(files.repo);
  const values: Values = {
    ...flattenedSettings(settings),
    ...skillsValues(settings, skillsDirectory),
    ...llmValues(settings, { environment, configHome, requiresModel, hasApiKey }),
  };
  const read = [files.machine, files.repo].flatMap((file) => (file === null ? [] : [file.source]));
  logger.child("config_resolver").info(`Config files, lowest first: ${read.join(" < ")}.`);
  return values;
}

/**
 * Resolves one run's configuration from every layer.
 *
 * @returns The validated `Config`. Without a config file, the environment alone describes the run.
 */
export function resolveConfig(options: ResolveOptions): Config {
  const { files, sources } = options;
  const environment = mergedEnvironment(sources);

  let fromFiles: Values = {};
  if (files.machine !== null || files.repo !== null) {
    const supplied = suppliedAliases(sources);
    const all = fileValues({
      files,
      environment,
      configHome: options.configHome,
      hasApiKey: supplied.has(CONFIG_ALIASES.apiKey),
      ...(options.requiresModel !== undefined && { requiresModel: options.requiresModel }),
      ...(options.logger && { logger: options.logger }),
    });
    fromFiles = Object.fromEntries(
      Object.entries(all).filter(([field]) => !supplied.has(aliasOf(field as ConfigField))),
    );
  }

  const values: Record<string, unknown> = { ...environment };
  const layered = Object.entries({ ...fromFiles, ...options.overrides });
  for (const [field, value] of layered) {
    values[CONFIG_ALIASES[field as ConfigField]] = value;
  }
  return buildConfig(values, {
    providers: options.providers,
    cpuCount: options.cpuCount,
    ...(options.requiresModel !== undefined && { requiresModel: options.requiresModel }),
  });
}
