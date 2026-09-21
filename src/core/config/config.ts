/**
 * One run's configuration, built by convict from the schema: the machine's file under the repository's, the
 * environment over both, the command line over everything, then validated as a whole.
 * @packageDocumentation
 */

import convict from "convict";

import { errorMessage } from "../util/errors";
import { show } from "../util/text";

import { type ConfigFile } from "./config-file";
import { hasReference, rejectBareVariableName } from "./environment-reference";
import { languageName } from "./language";
import {
  CONFIG_ALIASES,
  type ConfigField,
  type ConfigShape,
  FIELD_PATHS,
  type RegisteredProviders,
  type SkillDefaultShape,
  configSchema,
} from "./schema";
import {
  type ConcurrencyLimits,
  type FileReviewSettings,
  type LlmSettings,
  type ReportPolicy,
  type SkillDefaults,
  type SkillMappings,
  type SkillSettings,
} from "./settings";

export { CONFIG_ALIASES, type ConfigField, type RegisteredProviders } from "./schema";

/** Settings that cannot be used as written. */
export class ConfigError extends Error {
  override readonly name = "ConfigError";
}

/**
 * The default number of files reviewed at once.
 *
 * @param cpuCount - The machine's parallelism; `null` or `<= 0` reads as 4.
 * @returns The CPU count clamped to `[2, 8]`.
 */
export function defaultConcurrency(cpuCount: number | null): number {
  const cpu = cpuCount === null || cpuCount <= 0 ? 4 : cpuCount;
  return Math.max(2, Math.min(8, cpu));
}

/** What {@link buildConfig} needs. */
export interface BuildConfigOptions {
  /** The environment and the `.env` layers, already merged; names are matched case-insensitively, `""` is unset. */
  readonly environment: Readonly<Record<string, string | undefined>>;
  /** The config files, lowest precedence first: the machine's, then the repository's. */
  readonly files?: readonly ConfigFile[];
  /** Command-line settings by field; they outrank every other layer. */
  readonly overrides?: Readonly<Partial<Record<ConfigField, unknown>>>;
  /** `LLM_PROVIDER` must name one of these. */
  readonly providers: RegisteredProviders;
  /** The machine's parallelism, for the concurrency default; `null` reads as 4. */
  readonly cpuCount: number | null;
  /** `false` for a flow that builds no model (`--preview`), so its key is not demanded. */
  readonly requiresModel?: boolean;
  /** Where the machine's `.env` lives, for messages. */
  readonly configHome?: string;
}

/** The typed value of every field, keyed by field name. */
export interface ConfigValues {
  readonly provider: string;
  /** `null` takes the provider's default. */
  readonly model: string | null;
  readonly apiKey: string;
  readonly baseUrl: string | null;
  /** The language's English name, for the prompt. */
  readonly reviewLang: string;
  readonly verifyFindings: boolean;
  readonly excludeGlobs: readonly string[];
  readonly maxFindingsPerFile: number;
  readonly maxFileChars: number;
  readonly maxSkillChars: number;
  readonly maxSkillsTotalChars: number;
  readonly maxContextChars: number;
  readonly maxConcurrentFiles: number;
  readonly skillsPath: string;
  readonly skillDefaults: SkillDefaults;
  readonly skillMappings: SkillMappings;
}

/** Validated configuration for one run, plus the typed views the flows read. Immutable. */
export interface Config extends ConfigValues {
  /** The model knobs; the vendor's name is `provider`. */
  llmSettings(): LlmSettings;
  /** What one file review reads; `extraExclude` adds the command line's globs. */
  fileReviewSettings(extraExclude?: readonly string[]): FileReviewSettings;
  /** How many findings one file may report. */
  reportPolicy(): ReportPolicy;
  /** Where the skills are and which files each reviews. */
  skillSettings(): SkillSettings;
  /** How much runs at once. */
  concurrency(): ConcurrencyLimits;
}

/** The environment as convict reads it: names uppercased, empty values dropped so a blank CI input is not an override. */
function environmentFor(
  environment: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const upper: Record<string, string> = {};
  for (const [name, value] of Object.entries(environment)) {
    if (value !== undefined && value.trim() !== "") upper[name.toUpperCase()] = value;
  }
  return upper;
}

/**
 * Builds a `Config`.
 *
 * @returns The validated, frozen configuration.
 * @throws {@link ConfigError} listing every validation issue, an unknown key, an unresolved `${...}` reference,
 * or a missing key when a model is to be called.
 */
export function buildConfig(options: BuildConfigOptions): Config {
  const requiresModel = options.requiresModel ?? true;
  const config = convict(configSchema(options.providers), {
    env: environmentFor(options.environment),
    args: [],
  });
  const files = options.files ?? [];
  for (const file of files) config.load(file.values);
  const overrides = Object.entries(options.overrides ?? {});
  for (const [field, value] of overrides) {
    if (value !== undefined) config.set(FIELD_PATHS[field as ConfigField], value);
  }
  try {
    // The report is thrown, not printed: a run's stderr is the logger's, and the error carries every line.
    config.validate({ allowed: "strict", output: noOutput });
  } catch (error) {
    throw new ConfigError(errorMessage(error));
  }
  const shape = config.getProperties();
  checkReferences(shape, requiresModel, options.configHome ?? "~/.config/reviewer");
  return withViews(valuesFrom(shape, options.cpuCount, requiresModel));
}

/**
 * A `${...}` the files wrote and the environment could not answer is an error, named by its setting. The key
 * alone is let through when no model is called: `--preview` sends nothing.
 */
function checkReferences(shape: ConfigShape, requiresModel: boolean, configHome: string): void {
  const strings: readonly [ConfigField, string][] = [
    ["provider", shape.settings.llm.provider],
    ["model", shape.settings.llm.model],
    ["apiKey", shape.settings.llm["api-key"]],
    ["baseUrl", shape.settings.llm["base-url"]],
    ["reviewLang", shape.settings.language],
    ["skillsPath", shape.skills.path],
  ];
  for (const [field, value] of strings) {
    if (field === "apiKey") rejectBareVariableName(value, FIELD_PATHS[field]);
    if (!hasReference(value) || (field === "apiKey" && !requiresModel)) continue;
    throw new ConfigError(
      `${FIELD_PATHS[field]} reads ${show(value)}, which is not set. Put the variable in ${configHome}/.env or export it.`,
    );
  }
  if (requiresModel && shape.settings.llm["api-key"].trim() === "") {
    throw new ConfigError(
      `${FIELD_PATHS.apiKey} is not set: give ${CONFIG_ALIASES.apiKey}, or write \${VARIABLE} in config.yaml and put the variable in ${configHome}/.env.`,
    );
  }
}

/** Where convict would print its report; the thrown error carries it instead. */
function noOutput(): void {
  // Intentionally silent.
}

/** `""` reads as unset where the schema allows it. */
function orNull(value: string): string | null {
  return value.trim() === "" ? null : value;
}

/** Maps the file's shape to the facade's fields. */
function valuesFrom(
  shape: ConfigShape,
  cpuCount: number | null,
  requiresModel: boolean,
): ConfigValues {
  const { llm } = shape.settings;
  const apiKey = llm["api-key"];
  return {
    provider: llm.provider,
    model: orNull(llm.model),
    // An unresolved reference is let through for a run that sends nothing; it must not look like a key.
    apiKey: !requiresModel && hasReference(apiKey) ? "" : apiKey,
    baseUrl: orNull(llm["base-url"]),
    reviewLang: languageName(shape.settings.language),
    verifyFindings: shape.settings.verify,
    excludeGlobs: shape.settings.exclude,
    maxFindingsPerFile: shape.settings["max-findings-per-file"],
    maxFileChars: shape.settings["max-file-chars"],
    maxSkillChars: shape.settings["max-skill-chars"],
    maxSkillsTotalChars: shape.settings["max-skills-total-chars"],
    maxContextChars: shape.settings["max-context-chars"],
    maxConcurrentFiles:
      shape.settings["max-concurrent-files"] <= 0
        ? defaultConcurrency(cpuCount)
        : shape.settings["max-concurrent-files"],
    skillsPath: shape.skills.path,
    skillDefaults: normalisedDefaults(shape.skills.defaults),
    skillMappings: normalisedMappings(shape.skills.mappings),
  };
}

/** One bare entry becomes a list of one; every string is trimmed and an empty one is dropped. */
function asList(value: string | string[]): string[] {
  return (typeof value === "string" ? [value] : value)
    .map((item) => item.trim())
    .filter((item) => item !== "");
}

/** One bare glob becomes a list; names and globs are trimmed, empty globs dropped. */
function normalisedMappings(mappings: Record<string, string | string[]>): SkillMappings {
  return Object.fromEntries(
    Object.entries(mappings).map(([name, globs]) => [name.trim(), asList(globs)]),
  );
}

/** The same normalisation for the baseline, whose entries carry the two lists side by side. */
function normalisedDefaults(defaults: SkillDefaultShape[]): SkillDefaults {
  return defaults.map((entry) => ({ globs: asList(entry.globs), skills: asList(entry.skills) }));
}

/** Attaches the derived views to one immutable set of values. */
function withViews(values: ConfigValues): Config {
  return Object.freeze({
    ...values,
    llmSettings: () => ({
      apiKey: values.apiKey,
      baseUrl: values.baseUrl,
      model: values.model,
    }),
    fileReviewSettings: (extraExclude: readonly string[] = []) => ({
      exclude: [...values.excludeGlobs, ...extraExclude],
      language: values.reviewLang,
      maxFileChars: values.maxFileChars,
      maxSkillChars: values.maxSkillChars,
      maxSkillsTotalChars: values.maxSkillsTotalChars,
      maxContextChars: values.maxContextChars,
    }),
    reportPolicy: () => ({ maxFindingsPerFile: values.maxFindingsPerFile }),
    skillSettings: () => ({
      path: values.skillsPath,
      defaults: values.skillDefaults,
      mappings: values.skillMappings,
    }),
    concurrency: () => ({ files: values.maxConcurrentFiles }),
  });
}
