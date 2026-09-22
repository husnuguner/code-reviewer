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
    context: {
      "max-chars": number;
      "max-definitions": number;
      "max-symbols": number;
      "max-usages-per-symbol": number;
      "max-related": number;
    };
    "max-concurrent-files": number;
  };
  skills: {
    path: string;
    "max-chars": number;
    defaults: SkillDefaultShape[];
    mappings: Record<string, string | string[]>;
  };
}

/** One `skills.defaults` entry as the file writes it: each side a list, or one bare string. */
export interface SkillDefaultShape {
  globs: string | string[];
  skills: string | string[];
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
        if (FALSE_WORDS.has(word)) return false;
        return value; // left as written, for validate() to name
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
          if (!isStringList(globs))
            throw new TypeError(`${show(name)} must map to a glob or a list of globs`);
        }
      },
    },
    /**
     * The baseline: a list of `{ globs, skills }` entries. A list and not an object keyed by glob because
     * convict reads a key as a dotted path and every useful glob carries a dot. Read from the files only:
     * a repository's baseline is part of that repository, not of the shell that runs the reviewer.
     */
    "skill-defaults": {
      validate: (value: unknown) => {
        if (!Array.isArray(value)) {
          throw new TypeError("must be a list of { globs, skills } entries");
        }
        for (const [index, entry] of value.entries()) validateDefault(entry, index);
      },
    },
  });
}

/** One string, or a list of them: how both skill tables spell every value. */
function isStringList(value: unknown): boolean {
  return (
    typeof value === "string" ||
    (Array.isArray(value) && value.every((item) => typeof item === "string"))
  );
}

/** One `skills.defaults` entry: `globs` and `skills`, each a string or a list of them, and nothing else. */
function validateDefault(entry: unknown, index: number): void {
  const at = `entry ${index + 1}`;
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
    throw new TypeError(`${at} must be an object with 'globs' and 'skills'`);
  }
  const extra = Object.keys(entry).filter((key) => key !== "globs" && key !== "skills");
  if (extra.length > 0) throw new TypeError(`${at} has no place for ${show(extra)}`);
  for (const key of ["globs", "skills"] as const) {
    const listed = (entry as Record<string, unknown>)[key];
    if (listed === undefined) throw new TypeError(`${at} is missing ${show(key)}`);
    if (!isStringList(listed)) {
      throw new TypeError(`${at}: ${show(key)} must be one name or a list of them`);
    }
  }
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

/** Field → its path in the file (`settings.llm.api-key`), for `set()` and for messages. */
export const FIELD_PATHS = {
  provider: "settings.llm.provider",
  model: "settings.llm.model",
  apiKey: "settings.llm.api-key",
  baseUrl: "settings.llm.base-url",
  reviewLang: "settings.language",
  verifyFindings: "settings.verify",
  excludeGlobs: "settings.exclude",
  maxFindingsPerFile: "settings.max-findings-per-file",
  maxSkillChars: "skills.max-chars",
  maxContextChars: "settings.context.max-chars",
  maxDefinitions: "settings.context.max-definitions",
  maxSymbols: "settings.context.max-symbols",
  maxUsagesPerSymbol: "settings.context.max-usages-per-symbol",
  maxRelated: "settings.context.max-related",
  maxConcurrentFiles: "settings.max-concurrent-files",
  skillsPath: "skills.path",
  skillDefaults: "skills.defaults",
  skillMappings: "skills.mappings",
} as const;

/** A setting's field name on the `Config` facade. */
export type ConfigField = keyof typeof FIELD_PATHS;

/**
 * Field → the environment alias that overrides it, for documentation and messages.
 *
 * @remarks Not every field has one, and the line is deliberate: a variable carries what the shell knows
 * (which vendor, which key, which endpoint, how much to run at once), while **how much of the
 * repository a review reads** -- the skills budget, the pre-context budget and the skills tables --
 * is a judgement about the code. That belongs in a config file, where it is reviewed and versioned and
 * a stray variable on a runner cannot flatten it.
 */
export const CONFIG_ALIASES = {
  provider: "LLM_PROVIDER",
  model: "LLM_MODEL",
  apiKey: "LLM_API_KEY",
  baseUrl: "LLM_BASE_URL",
  reviewLang: "REVIEW_LANG",
  verifyFindings: "REVIEW_VERIFY",
  excludeGlobs: "REVIEW_EXCLUDE_PATHS",
  maxFindingsPerFile: "REVIEW_MAX_FINDINGS_PER_FILE",
  maxConcurrentFiles: "REVIEW_MAX_CONCURRENT_FILES",
  skillsPath: "REVIEW_SKILLS_PATH",
  skillMappings: "REVIEW_SKILL_MAPPINGS",
} as const satisfies Partial<Record<ConfigField, string>>;

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
      // The pre-context budget, together: a block cap and what may fill it. From the files only; the
      // whole section has no environment alias.
      context: {
        "max-chars": {
          doc: "Cap on the whole pre-context block, which its parts share; 0 switches it off.",
          format: "count",
          default: 12_000,
        },
        "max-definitions": {
          doc: "Imported modules whose signatures are read, per file.",
          format: "count",
          default: 4,
        },
        "max-symbols": {
          doc: "Changed exports searched for across the repository, per file; one search each.",
          format: "count",
          default: 6,
        },
        "max-usages-per-symbol": {
          doc: "Paths listed per changed export.",
          format: "count",
          default: 8,
        },
        "max-related": {
          doc: "Related diffs included, import-bound first.",
          format: "count",
          default: 3,
        },
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
      "max-chars": {
        doc: "Cap on one skill's body; the whole block's ceiling is a constant. From the files only; no environment alias.",
        format: "count",
        default: 10_000,
      },
      defaults: {
        doc: "Glob → the skills every file it matches is held to, whatever mappings add. From the files only; no environment alias.",
        format: "skill-defaults",
        default: [],
      },
      mappings: {
        doc: "Skill name → the globs only it reviews, added to what defaults gave it; from the environment, as JSON.",
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
