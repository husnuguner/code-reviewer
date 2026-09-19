/**
 * The vocabulary of `config.yaml`, as a convict schema: every setting with its default, the environment
 * variable that overrides it, its format and a line of documentation. One table; convict does the merging,
 * coercion, validation and precedence from it.
 * @packageDocumentation
 */

import convict from "convict";

import { show, sortedByCodePoint } from "../util/text";

/** The schema version this build understands; a newer file is refused. */
export const SCHEMA_VERSION = 1;

/** The LLM providers registered for this run, as the composition root knows them. */
export interface RegisteredProviders {
  /** Every accepted name. */
  readonly names: readonly string[];
  /** What `LLM_PROVIDER` means when unset. */
  readonly default: string;
}

/** The configuration as the file and the schema shape it: `settings` for how the reviewer runs, `skills` for what the code is held to. */
export interface ConfigShape {
  version: number;
  settings: {
    llm: {
      provider: string;
      model: string;
      "api-key": string;
      "base-url": string;
    };
    language: string;
    verify: boolean;
    exclude: string[];
    "max-findings-per-file": number;
    "max-file-chars": number;
    "max-skill-chars": number;
    "max-skills-total-chars": number;
    "max-context-chars": number;
    "max-concurrent-files": number;
  };
  skills: {
    path: string;
    mappings: Record<string, string | string[]>;
  };
}

/** The root keys only a repository's `.review/config.yaml` may set: they describe the reviewed code, not the machine. */
export const REPO_ONLY_KEYS = ["skills"] as const satisfies readonly (keyof ConfigShape)[];

// -- formats ------------------------------------------------------------------

const TRUE_WORDS: ReadonlySet<string> = new Set(["1", "true", "yes", "on"]);
const FALSE_WORDS: ReadonlySet<string> = new Set(["0", "false", "no", "off"]);

/** Splits comma- or newline-separated values, trimmed, empties dropped. */
export function csv(raw: string): string[] {
  return raw
    .replaceAll("\n", ",")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");
}

/** Registers the reviewer's formats with convict; convict keeps one per name, so repeating this is harmless. */
function addFormats(): void {
  convict.addFormats({
    /** A yes/no setting: a boolean, or one of the words an environment can carry; an unknown word is an error, not a guess. */
    "yes-no": {
      coerce: (value: unknown) => {
        if (typeof value !== "string") return value;
        const word = value.trim().toLowerCase();
        if (TRUE_WORDS.has(word)) return true;
        return FALSE_WORDS.has(word) ? false : value;
      },
      validate: (value: unknown) => {
        if (typeof value !== "boolean") {
          throw new TypeError(`must be one of ${show([...TRUE_WORDS, ...FALSE_WORDS])}`);
        }
      },
    },
    /** A whole number, zero included; spelled as digits when it comes from the environment. Never a float or a word. */
    count: {
      coerce: (value: unknown) =>
        typeof value === "string" && /^\+?\d+$/u.test(value.trim()) ? Number(value.trim()) : value,
      validate: (value: unknown) => {
        if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
          throw new TypeError("must be a whole number");
        }
      },
    },
    /** An integer of either sign; spelled as digits when it comes from the environment. Never a float or a word. */
    integer: {
      coerce: (value: unknown) =>
        typeof value === "string" && /^[+-]?\d+$/u.test(value.trim())
          ? Number(value.trim())
          : value,
      validate: (value: unknown) => {
        if (typeof value !== "number" || !Number.isSafeInteger(value)) {
          throw new TypeError("must be an integer");
        }
      },
    },
    /** A list of globs: a list, or one comma- or newline-separated string. */
    "glob-list": {
      coerce: (value: unknown) => (typeof value === "string" ? csv(value) : value),
      validate: (value: unknown) => {
        if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
          throw new TypeError("must be a list of globs");
        }
      },
    },
    /** Skill name → globs; from the environment, that object as JSON text. */
    "skill-mappings": {
      coerce: (value: unknown) => {
        if (typeof value !== "string") return value;
        if (value.trim() === "") return {};
        try {
          return JSON.parse(value) as unknown;
        } catch {
          return value;
        }
      },
      validate: (value: unknown) => {
        const isObject = typeof value === "object" && value !== null && !Array.isArray(value);
        if (!isObject)
          throw new TypeError(
            "must be an object of skill name → globs (as JSON, from the environment)",
          );
        for (const [name, globs] of Object.entries(value)) {
          const isOk =
            typeof globs === "string" ||
            (Array.isArray(globs) && globs.every((glob) => typeof glob === "string"));
          if (!isOk) throw new TypeError(`${show(name)} must map to a glob or a list of globs`);
        }
      },
    },
  });
}

/**
 * Registers the provider-name format for this run's registry: trimmed and lowercased on the way in, then one
 * of the registered names. Re-registered per run because the names come from the registry, not the core;
 * convict keeps one format per name, so the latest registration is the one in force.
 */
function addProviderFormat(providers: RegisteredProviders): void {
  const accepted = sortedByCodePoint(providers.names);
  convict.addFormat({
    name: "provider-name",
    coerce: (value: unknown) => (typeof value === "string" ? value.trim().toLowerCase() : value),
    validate: (value: unknown) => {
      if (typeof value !== "string" || !providers.names.includes(value)) {
        throw new TypeError(`must be one of ${show(accepted)}, got: ${show(value)}`);
      }
    },
  });
}

// -- the schema ---------------------------------------------------------------

/** Field → the environment alias that overrides it, for documentation and messages. */
export const CONFIG_ALIASES = {
  provider: "LLM_PROVIDER",
  model: "LLM_MODEL",
  apiKey: "LLM_API_KEY",
  baseUrl: "LLM_BASE_URL",
  reviewLang: "REVIEW_LANG",
  verifyFindings: "REVIEW_VERIFY",
  excludeGlobs: "REVIEW_EXCLUDE_PATHS",
  maxFindingsPerFile: "REVIEW_MAX_FINDINGS_PER_FILE",
  maxFileChars: "REVIEW_MAX_FILE_CHARS",
  maxSkillChars: "REVIEW_MAX_SKILL_CHARS",
  maxSkillsTotalChars: "REVIEW_MAX_SKILLS_TOTAL_CHARS",
  maxContextChars: "REVIEW_MAX_CONTEXT_CHARS",
  maxConcurrentFiles: "REVIEW_MAX_CONCURRENT_FILES",
  skillsPath: "REVIEW_SKILLS_PATH",
  skillMappings: "REVIEW_SKILL_MAPPINGS",
} as const;

/** A setting's field name on the `Config` facade. */
export type ConfigField = keyof typeof CONFIG_ALIASES;

/** Field → its path in the file (`settings.llm.api-key`), for `set()` and for messages. */
export const FIELD_PATHS: Readonly<Record<ConfigField, string>> = {
  provider: "settings.llm.provider",
  model: "settings.llm.model",
  apiKey: "settings.llm.api-key",
  baseUrl: "settings.llm.base-url",
  reviewLang: "settings.language",
  verifyFindings: "settings.verify",
  excludeGlobs: "settings.exclude",
  maxFindingsPerFile: "settings.max-findings-per-file",
  maxFileChars: "settings.max-file-chars",
  maxSkillChars: "settings.max-skill-chars",
  maxSkillsTotalChars: "settings.max-skills-total-chars",
  maxContextChars: "settings.max-context-chars",
  maxConcurrentFiles: "settings.max-concurrent-files",
  skillsPath: "skills.path",
  skillMappings: "skills.mappings",
};

/**
 * The schema, for one run's registered providers.
 *
 * @remarks Built per run because the provider names come from the registry, not from the core.
 */
export function configSchema(providers: RegisteredProviders): convict.Schema<ConfigShape> {
  addFormats();
  addProviderFormat(providers);
  return {
    version: {
      doc: "Schema version. Optional; a newer number than this build knows is refused.",
      format: "count",
      default: SCHEMA_VERSION,
    },
    settings: {
      llm: {
        provider: {
          doc: "local (any OpenAI-compatible endpoint) or claude (Anthropic).",
          format: "provider-name",
          default: providers.default,
          env: CONFIG_ALIASES.provider,
        },
        model: {
          doc: "Model name; empty takes the provider's own default.",
          format: String,
          default: "",
          env: CONFIG_ALIASES.model,
        },
        "api-key": {
          doc: "The key, or ${VARIABLE} to read it from the environment. Required when a model is called.",
          format: String,
          default: "",
          env: CONFIG_ALIASES.apiKey,
          sensitive: true,
        },
        "base-url": {
          doc: "Endpoint URL including the API prefix; empty takes the provider's public endpoint.",
          format: String,
          default: "",
          env: CONFIG_ALIASES.baseUrl,
        },
      },
      language: {
        doc: "Language of each finding's body; an unknown one falls back to English.",
        format: String,
        default: "en",
        env: CONFIG_ALIASES.reviewLang,
      },
      verify: {
        doc: "Run the verification pass that drops findings the diff refutes.",
        format: "yes-no",
        default: true,
        env: CONFIG_ALIASES.verifyFindings,
      },
      exclude: {
        doc: "Globs never sent to the model; a list, or one comma-separated string.",
        format: "glob-list",
        default: [],
        env: CONFIG_ALIASES.excludeGlobs,
      },
      "max-findings-per-file": {
        doc: "Per-file cap; the most severe survive. 0 = no cap.",
        format: "count",
        default: 3,
        env: CONFIG_ALIASES.maxFindingsPerFile,
      },
      "max-file-chars": {
        doc: "Per-file cap on the diff shown; a longer diff is cut at a hunk boundary.",
        format: "count",
        default: 8000,
        env: CONFIG_ALIASES.maxFileChars,
      },
      "max-skill-chars": {
        doc: "Cap on one skill's body.",
        format: "count",
        default: 10_000,
        env: CONFIG_ALIASES.maxSkillChars,
      },
      "max-skills-total-chars": {
        doc: "Cap on one file's whole skills block.",
        format: "count",
        default: 18_000,
        env: CONFIG_ALIASES.maxSkillsTotalChars,
      },
      "max-context-chars": {
        doc: "Cap on the pre-context block; 0 switches it off.",
        format: "count",
        default: 6000,
        env: CONFIG_ALIASES.maxContextChars,
      },
      "max-concurrent-files": {
        doc: "File reviews in flight at once; 0 or less derives it from the CPU count.",
        format: "integer",
        default: 0,
        env: CONFIG_ALIASES.maxConcurrentFiles,
      },
    },
    skills: {
      path: {
        doc: "Directory of skill documents; a relative path is taken from beside the repository's file. Empty: no skills.",
        format: String,
        default: "",
        env: CONFIG_ALIASES.skillsPath,
      },
      mappings: {
        doc: "Skill name → globs it reviews; from the environment, as JSON.",
        format: "skill-mappings",
        default: {},
        env: CONFIG_ALIASES.skillMappings,
      },
    },
  };
}

/** The keys of the `settings` section, read off the schema. */
export const SETTINGS_SECTION_KEYS = Object.keys(
  configSchema({ names: ["local"], default: "local" }).settings,
) as readonly (keyof ConfigShape["settings"])[];

/** The keys at the root of the file, beside `version`. */
export const ROOT_KEYS = ["settings", "skills"] as const;
