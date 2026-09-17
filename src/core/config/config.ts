/**
 * The run's flat settings, typed and validated.
 *
 * Every setting is populated from an uppercase environment name (its
 * *alias*); the same aliases are what a catalogue project and the command line
 * resolve onto before this schema sees them, so precedence is settled in one
 * place (`resolver.ts`) and typing in another (here).
 *
 * The LLM provider is validated against the registered provider names and the
 * concurrency knob falls back to a CPU-derived default when unset. Nothing
 * here reads a file or the process environment: the values arrive already
 * merged.
 */

import { z } from "zod";

import { type ProviderSettings } from "../llm/provider-registry";
import { pyRepr, pyString, pyStrip } from "../util/py";

import { languageName } from "./language";
import {
  type ConcurrencyLimits,
  type FileReviewSettings,
  type PromptFiles,
  type ReportPolicy,
  type SkillMappings,
  type SkillSettings,
} from "./settings";

/** Settings that cannot be used as written. */
export class ConfigError extends Error {
  override readonly name = "ConfigError";
}

/** How many files are reviewed at once, derived from the CPU count and capped. */
export function defaultConcurrency(cpuCount: number | null): number {
  const cpu = cpuCount === null || cpuCount <= 0 ? 4 : cpuCount;
  return Math.max(2, Math.min(8, cpu));
}

/** Field -> the environment alias it is populated from. */
export const CONFIG_ALIASES = {
  provider: "LLM_PROVIDER",
  modelName: "LLM_MODEL",
  apiKey: "LLM_API_KEY",
  baseUrl: "LLM_BASE_URL",
  localPath: "REVIEW_LOCAL_PATH",
  maxFileChars: "PR_REVIEW_MAX_FILE_CHARS",
  skillsPath: "REVIEW_SKILLS_PATH",
  skillMappings: "REVIEW_SKILL_MAPPINGS",
  promptFiles: "REVIEW_PROMPT_FILES",
  maxSkillChars: "REVIEW_MAX_SKILL_CHARS",
  maxSkillsTotalChars: "REVIEW_MAX_SKILLS_TOTAL_CHARS",
  maxContextChars: "REVIEW_MAX_CONTEXT_CHARS",
  maxFindingsPerFile: "REVIEW_MAX_FINDINGS_PER_FILE",
  verifyFindings: "REVIEW_VERIFY",
  reviewLang: "REVIEW_LANG",
  excludePaths: "REVIEW_EXCLUDE_PATHS",
  maxConcurrentFiles: "REVIEW_MAX_CONCURRENT_FILES",
} as const;

export type ConfigField = keyof typeof CONFIG_ALIASES;
export type ConfigAlias = (typeof CONFIG_ALIASES)[ConfigField];

/** The alias a field is populated from. */
export function aliasOf(field: ConfigField): ConfigAlias {
  return CONFIG_ALIASES[field];
}

// -- value coercions ----------------------------------------------------------

/** A string as the environment supplies it; other scalars are spelled out. */
const text = z.preprocess(
  (value) => (value === undefined ? undefined : pyString(value)),
  z.string(),
);

/** `""` (or whitespace) reads as unset. */
const optionalText = z.preprocess(
  (value) =>
    value === undefined || value === null || pyStrip(pyString(value)) === ""
      ? null
      : pyString(value),
  z.string().nullable(),
);

/** One glob, or a list of them. */
const globOrGlobs = z.union([z.string(), z.array(z.string())]);

/**
 * A list of paths. From the catalogue it is a list; from the environment it
 * is comma-separated text (or a JSON list). Blanks are dropped.
 */
const pathList = z.preprocess(
  (value) => {
    if (typeof value !== "string") return value;
    const text = pyStrip(value);
    if (text === "") return [];
    if (text.startsWith("[")) {
      try {
        return JSON.parse(text) as unknown;
      } catch {
        return value;
      }
    }
    return text.split(",");
  },
  z
    .array(z.string())
    .transform((paths): PromptFiles =>
      paths.map((path) => pyStrip(path)).filter((path) => path !== ""),
    ),
);

/**
 * Skill name -> globs. From the catalogue it is `skills.mappings`; from the
 * environment it is that object as JSON text. One glob may be given bare.
 */
const skillMappings = z.preprocess(
  (value) => {
    if (typeof value !== "string") return value;
    if (pyStrip(value) === "") return {};
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
          pyStrip(name),
          (typeof globs === "string" ? [globs] : globs)
            .map((glob) => pyStrip(glob))
            .filter((glob) => glob !== ""),
        ]),
      ),
    ),
);

const TRUE_WORDS: ReadonlySet<string> = new Set(["1", "true", "yes", "on"]);
const FALSE_WORDS: ReadonlySet<string> = new Set(["0", "false", "no", "off"]);

/**
 * A yes/no setting: a real boolean from the catalogue, or the word an
 * environment can carry. An empty value reads as unset, so `REVIEW_VERIFY=`
 * in a `.env` takes the default rather than silently meaning "no"; a word
 * that is neither is a configuration error rather than a guess.
 */
function flag(isOnByDefault: boolean) {
  return z.preprocess((value) => {
    if (typeof value !== "string") return value;
    const word = pyStrip(value).toLowerCase();
    // Nothing returned: the schema's own default answers for an empty value.
    if (word === "") return;
    if (TRUE_WORDS.has(word)) return true;
    return FALSE_WORDS.has(word) ? false : value;
  }, z.boolean().default(isOnByDefault));
}

/** An integer, possibly spelled as a string (`"2"`), never a float or a word. */
const integer = z.preprocess((value) => {
  if (typeof value === "number") return value;
  return typeof value === "string" && /^[+-]?\d+$/u.test(pyStrip(value))
    ? Number(pyStrip(value))
    : value;
}, z.number().int());

function rawSchema(providerNames: readonly string[]) {
  return z.object({
    LLM_PROVIDER: text
      .default("local")
      .transform((value) => pyStrip(value).toLowerCase())
      .refine((value) => providerNames.includes(value), {
        error: (issue) =>
          `LLM_PROVIDER must be one of ${pyRepr([...providerNames])}, got: ${pyRepr(issue.input)}`,
      }),
    LLM_MODEL: optionalText.default(null),
    LLM_API_KEY: text,
    LLM_BASE_URL: optionalText.default(null),
    REVIEW_LOCAL_PATH: text.default(""),
    PR_REVIEW_MAX_FILE_CHARS: integer.default(8000),
    REVIEW_SKILLS_PATH: text.default(""),
    REVIEW_SKILL_MAPPINGS: skillMappings.default({}),
    REVIEW_PROMPT_FILES: pathList.default([]),
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

export interface ConfigOptions {
  /** Registered LLM provider names, which `LLM_PROVIDER` must be one of. */
  readonly providerNames: readonly string[];
  /** The machine's parallelism, for the concurrency defaults (`null` -> 4). */
  readonly cpuCount: number | null;
  /**
   * False for a flow that builds no language model, so its credential is not
   * demanded: `--preview` decides scope and calls nobody, and a pre-flight
   * that refused to run without a key it will never send would be a
   * pre-flight nobody could use before they had one.
   */
  readonly requiresModel?: boolean;
}

/** The typed value of every field, keyed by field name, derived from the alias table. */
export type ConfigValues = {
  readonly [F in ConfigField]: RawConfig[(typeof CONFIG_ALIASES)[F]];
};

/**
 * Validated configuration for a single review run: every field from the alias
 * table, plus the derived views the flows read. Immutable once built.
 */
export interface Config extends ConfigValues {
  /** Globs whose files are skipped entirely. */
  readonly excludeGlobs: readonly string[];
  /** The LLM knobs, in the registry's own terms. */
  providerSettings(): ProviderSettings;
  /** What one file review reads; `extraExclude` adds the command line's globs. */
  fileReviewSettings(extraExclude?: readonly string[]): FileReviewSettings;
  /** How many findings one file may report. */
  reportPolicy(): ReportPolicy;
  /** Where the skills are and which files each one reviews. */
  skillSettings(): SkillSettings;
  /** How much runs at once. */
  concurrency(): ConcurrencyLimits;
}

/**
 * Build a `Config` from alias-keyed values (`LLM_API_KEY`, ...), matched
 * case-insensitively.
 */
export function buildConfig(
  values: Readonly<Record<string, unknown>>,
  options: ConfigOptions,
): Config {
  const upper: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) upper[key.toUpperCase()] = value;
  }
  // Everything else about the model still has to be valid -- a preview that
  // accepted a misspelled provider would be validating the wrong run.
  const keyAlias = CONFIG_ALIASES.apiKey;
  if (options.requiresModel === false && upper[keyAlias] === undefined) {
    upper[keyAlias] = "";
  }
  const parsed = rawSchema(options.providerNames).safeParse(upper);
  if (!parsed.success) {
    throw new ConfigError(formatIssues(parsed.error.issues));
  }
  return withViews(valuesFrom(parsed.data, options.cpuCount));
}

/** The derived views over one immutable set of values. */
function withViews(values: ConfigValues): Config {
  const excludeGlobs = csv(values.excludePaths);
  return Object.freeze({
    ...values,
    excludeGlobs,
    providerSettings: () => ({
      provider: values.provider,
      apiKey: values.apiKey,
      baseUrl: values.baseUrl,
      modelName: values.modelName,
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

/**
 * Field values from the alias-keyed schema output. The concurrency knob falls
 * back to a CPU-derived default when unset (`0`), which is the one place a
 * setting's value depends on another input.
 */
function valuesFrom(raw: RawConfig, cpuCount: number | null): ConfigValues {
  const defaultFiles = defaultConcurrency(cpuCount);
  const values = Object.fromEntries(
    Object.entries(CONFIG_ALIASES).map(([field, alias]) => [field, raw[alias]]),
  ) as { -readonly [F in ConfigField]: ConfigValues[F] };
  if (values.maxConcurrentFiles <= 0) values.maxConcurrentFiles = defaultFiles;
  return values;
}

/** Comma- or newline-separated values, trimmed, empties dropped. */
function csv(raw: string): string[] {
  return raw
    .replaceAll("\n", ",")
    .split(",")
    .map((item) => pyStrip(item))
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
