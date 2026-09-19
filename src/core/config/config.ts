/**
 * The run's flat settings, typed and validated. Values arrive already merged by the resolver.
 * @packageDocumentation
 */

import { z } from "zod";

import { asText, show, sortedByCodePoint } from "../util/text";

import { languageName } from "./language";
import {
  type ConcurrencyLimits,
  type FileReviewSettings,
  type LlmSettings,
  type ReportPolicy,
  type SkillMappings,
  type SkillSettings,
} from "./settings";

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

/** Field → the environment alias it is populated from. */
export const CONFIG_ALIASES = {
  provider: "LLM_PROVIDER",
  model: "LLM_MODEL",
  apiKey: "LLM_API_KEY",
  baseUrl: "LLM_BASE_URL",
  localPath: "REVIEW_LOCAL_PATH",
  maxFileChars: "REVIEW_MAX_FILE_CHARS",
  skillsPath: "REVIEW_SKILLS_PATH",
  skillMappings: "REVIEW_SKILL_MAPPINGS",
  maxSkillChars: "REVIEW_MAX_SKILL_CHARS",
  maxSkillsTotalChars: "REVIEW_MAX_SKILLS_TOTAL_CHARS",
  maxContextChars: "REVIEW_MAX_CONTEXT_CHARS",
  maxFindingsPerFile: "REVIEW_MAX_FINDINGS_PER_FILE",
  verifyFindings: "REVIEW_VERIFY",
  reviewLang: "REVIEW_LANG",
  excludePaths: "REVIEW_EXCLUDE_PATHS",
  maxConcurrentFiles: "REVIEW_MAX_CONCURRENT_FILES",
} as const;

/** A setting's field name. */
export type ConfigField = keyof typeof CONFIG_ALIASES;
/** A setting's environment alias. */
export type ConfigAlias = (typeof CONFIG_ALIASES)[ConfigField];

/** The alias a field is populated from. */
export function aliasOf(field: ConfigField): ConfigAlias {
  return CONFIG_ALIASES[field];
}

// -- value coercions ----------------------------------------------------------

/** A string; other scalars are spelled out. */
const text = z.preprocess((value) => (value === undefined ? undefined : asText(value)), z.string());

/** A string where `""` or whitespace reads as unset. */
const optionalText = z.preprocess(
  (value) =>
    value === undefined || value === null || asText(value).trim() === "" ? null : asText(value),
  z.string().nullable(),
);

/** One glob, or a list of them. */
const globOrGlobs = z.union([z.string(), z.array(z.string())]);

/** Skill name → globs; from the environment, that object as JSON text. */
const skillMappings = z.preprocess(
  (value) => {
    if (typeof value !== "string") return value;
    if (value.trim() === "") return {};
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return value;
    }
  },
  z
    .record(z.string(), globOrGlobs)
    .transform((rules): SkillMappings =>
      Object.fromEntries(
        Object.entries(rules).map(([name, globs]) => [
          name.trim(),
          (typeof globs === "string" ? [globs] : globs)
            .map((glob) => glob.trim())
            .filter((glob) => glob !== ""),
        ]),
      ),
    ),
);

const TRUE_WORDS: ReadonlySet<string> = new Set(["1", "true", "yes", "on"]);
const FALSE_WORDS: ReadonlySet<string> = new Set(["0", "false", "no", "off"]);

/**
 * A yes/no setting: a boolean, or one of the words an environment can carry.
 *
 * @remarks `""` takes the default; an unknown word is an error, not a guess.
 */
function flag(isOnByDefault: boolean) {
  return z.preprocess((value) => {
    if (typeof value !== "string") return value;
    const word = value.trim().toLowerCase();
    if (word === "") return;
    if (TRUE_WORDS.has(word)) return true;
    return FALSE_WORDS.has(word) ? false : value;
  }, z.boolean().default(isOnByDefault));
}

/** An integer, possibly spelled as a string; never a float or a word. */
const integer = z.preprocess((value) => {
  if (typeof value === "number") return value;
  return typeof value === "string" && /^[+-]?\d+$/u.test(value.trim())
    ? Number(value.trim())
    : value;
}, z.number().int());

function rawSchema(providers: RegisteredProviders) {
  const accepted = sortedByCodePoint(providers.names);
  return z.object({
    LLM_PROVIDER: text
      .default(providers.default)
      .transform((value) => value.trim().toLowerCase())
      .refine((value) => providers.names.includes(value), {
        error: (issue) =>
          `LLM_PROVIDER must be one of ${show(accepted)}, got: ${show(issue.input)}`,
      }),
    LLM_MODEL: optionalText.default(null),
    LLM_API_KEY: text,
    LLM_BASE_URL: optionalText.default(null),
    REVIEW_LOCAL_PATH: text.default(""),
    REVIEW_MAX_FILE_CHARS: integer.default(8000),
    REVIEW_SKILLS_PATH: text.default(""),
    REVIEW_SKILL_MAPPINGS: skillMappings.default({}),
    REVIEW_MAX_SKILL_CHARS: integer.default(10_000),
    REVIEW_MAX_SKILLS_TOTAL_CHARS: integer.default(18_000),
    REVIEW_MAX_CONTEXT_CHARS: integer.default(6000),
    REVIEW_MAX_FINDINGS_PER_FILE: integer.default(3),
    REVIEW_VERIFY: flag(true),
    REVIEW_LANG: text.default("en").transform(languageName),
    REVIEW_EXCLUDE_PATHS: text.default(""),
    REVIEW_MAX_CONCURRENT_FILES: integer.default(0),
  });
}

type RawConfig = z.output<ReturnType<typeof rawSchema>>;

// -- the settings object ------------------------------------------------------

/** The LLM providers registered for this run, as the composition root knows them. */
export interface RegisteredProviders {
  /** Every accepted name. */
  readonly names: readonly string[];
  /** What `LLM_PROVIDER` means when unset. */
  readonly default: string;
}

/** What `buildConfig` needs beyond the values. */
export interface ConfigOptions {
  /** `LLM_PROVIDER` must name one of these. */
  readonly providers: RegisteredProviders;
  /** The machine's parallelism, for the concurrency default; `null` reads as 4. */
  readonly cpuCount: number | null;
  /** `false` for a flow that builds no model (`--preview`), so its key is not demanded. */
  readonly requiresModel?: boolean;
}

/** The typed value of every field, keyed by field name. */
export type ConfigValues = {
  readonly [F in ConfigField]: RawConfig[(typeof CONFIG_ALIASES)[F]];
};

/** Validated configuration for one run, plus the typed views the flows read. Immutable. */
export interface Config extends ConfigValues {
  /** Globs whose files are skipped entirely. */
  readonly excludeGlobs: readonly string[];
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

/**
 * Builds a `Config` from alias-keyed values.
 *
 * @param values - Keyed by alias (`LLM_API_KEY`, …), matched case-insensitively.
 * @param options - Registered providers, CPU count, and whether a model key is required.
 * @returns The validated, frozen configuration.
 * @throws {@link ConfigError} listing every validation issue.
 */
export function buildConfig(
  values: Readonly<Record<string, unknown>>,
  options: ConfigOptions,
): Config {
  const upper: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) upper[key.toUpperCase()] = value;
  }
  const keyAlias = CONFIG_ALIASES.apiKey;
  if (options.requiresModel === false && upper[keyAlias] === undefined) {
    upper[keyAlias] = "";
  }
  const parsed = rawSchema(options.providers).safeParse(upper);
  if (!parsed.success) {
    throw new ConfigError(formatIssues(parsed.error.issues));
  }
  return withViews(valuesFrom(parsed.data, options.cpuCount));
}

/** Attaches the derived views to one immutable set of values. */
function withViews(values: ConfigValues): Config {
  const excludeGlobs = csv(values.excludePaths);
  return Object.freeze({
    ...values,
    excludeGlobs,
    llmSettings: () => ({
      apiKey: values.apiKey,
      baseUrl: values.baseUrl,
      model: values.model,
    }),
    fileReviewSettings: (extraExclude: readonly string[] = []) => ({
      exclude: [...excludeGlobs, ...extraExclude],
      language: values.reviewLang,
      maxFileChars: values.maxFileChars,
      maxSkillChars: values.maxSkillChars,
      maxSkillsTotalChars: values.maxSkillsTotalChars,
      maxContextChars: values.maxContextChars,
    }),
    reportPolicy: () => ({ maxFindingsPerFile: values.maxFindingsPerFile }),
    skillSettings: () => ({ path: values.skillsPath, mappings: values.skillMappings }),
    concurrency: () => ({ files: values.maxConcurrentFiles }),
  });
}

/** Maps schema output back to field names; `maxConcurrentFiles <= 0` takes the CPU-derived default. */
function valuesFrom(raw: RawConfig, cpuCount: number | null): ConfigValues {
  const defaultFiles = defaultConcurrency(cpuCount);
  const values = Object.fromEntries(
    Object.entries(CONFIG_ALIASES).map(([field, alias]) => [field, raw[alias]]),
  ) as { -readonly [F in ConfigField]: ConfigValues[F] };
  if (values.maxConcurrentFiles <= 0) values.maxConcurrentFiles = defaultFiles;
  return values;
}

/** Splits comma- or newline-separated values, trimmed, empties dropped. */
function csv(raw: string): string[] {
  return raw
    .replaceAll("\n", ",")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");
}

function formatIssues(
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
): string {
  const head = `${issues.length} validation error${issues.length === 1 ? "" : "s"} for Config`;
  const lines = issues.map(
    (issue) => `${issue.path.map(String).join(".") || "(root)"}: ${issue.message}`,
  );
  return [head, ...lines].join("\n");
}
