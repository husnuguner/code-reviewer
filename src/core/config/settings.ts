/**
 * The typed setting groups the flows read instead of the flat `Config`.
 * @packageDocumentation
 */

/** The model knobs. The vendor's name is `Config.provider`, passed beside them. */
export interface LlmSettings {
  /** `LLM_API_KEY` / `llm.api-key`; required, non-empty even for a local server. */
  readonly apiKey: string;
  /** `LLM_BASE_URL` / `llm.base-url`; `null` takes the vendor's endpoint. */
  readonly baseUrl: string | null;
  /** `LLM_MODEL` / `llm.model`; `null` when none was named. */
  readonly model: string | null;
}

/** What one file review reads. */
export interface FileReviewSettings {
  /** Globs whose files are skipped entirely. */
  readonly exclude: readonly string[];
  /** Language of each finding's body. */
  readonly language: string;
  /** Whether a `reviewer: by-pass - <reason>` marker in the code takes the block after it out of review. */
  readonly bypassMarkers: boolean;
  /** Per-skill body cap. */
  readonly maxSkillChars: number;
  /** Cap on the pre-context block; `0` = none. */
  readonly maxContextChars: number;
  /** Imported modules whose signatures are read, per file. */
  readonly maxDefinitions: number;
  /** Changed exports searched for across the repository, per file. */
  readonly maxSymbols: number;
  /** Paths listed per changed export. */
  readonly maxUsagesPerSymbol: number;
  /** Related diffs included, import-bound first. */
  readonly maxRelated: number;
}

/**
 * The built-in file review settings.
 *
 * @remarks The pre-context numbers are the same ones {@link DEFAULT_CONTEXT_LIMITS} states for a caller
 * that gathers context directly; `tests/core/review/context.test.ts` holds the two together.
 */
export const DEFAULT_FILE_REVIEW_SETTINGS: FileReviewSettings = {
  exclude: [],
  language: "English",
  bypassMarkers: true,
  maxSkillChars: 10_000,
  maxContextChars: 12_000,
  maxDefinitions: 4,
  maxSymbols: 6,
  maxUsagesPerSymbol: 8,
  maxRelated: 3,
};

/** How many findings one file may report. */
export interface ReportPolicy {
  /** Per-file cap; the most severe survive. `0` = uncapped. */
  readonly maxFindingsPerFile: number;
}

/** The built-in report policy. */
export const DEFAULT_REPORT_POLICY: ReportPolicy = {
  maxFindingsPerFile: 3,
};

/** How much runs at once. */
export interface ConcurrencyLimits {
  /** Simultaneous file reviews (content read + model call). */
  readonly files: number;
}

/** Skill name → path globs. `[]` switches a skill off; an unmapped skill never applies. */
export type SkillMappings = Readonly<Record<string, readonly string[]>>;

/**
 * One baseline entry: the skills every file these globs match is held to.
 *
 * @remarks Written the other way round from a mapping -- the paths first, then the skills -- because that is
 * how a project states it: "every TypeScript file is held to these". A list rather than a `glob: skills`
 * object because a config key is a dotted path, and every useful glob carries a dot.
 */
export interface SkillDefault {
  readonly globs: readonly string[];
  readonly skills: readonly string[];
}

/**
 * The baseline, stated once per group of paths instead of repeated under every skill that shares it. A skill
 * named here still takes whatever `mappings` adds to it.
 */
export type SkillDefaults = readonly SkillDefault[];

/** Where a project's skills are and what each applies to. */
export interface SkillSettings {
  /** Directory of the skill documents; `""` = no skills. */
  readonly path: string;
  /** The baseline every matching file is held to, whatever `mappings` adds. */
  readonly defaults: SkillDefaults;
  readonly mappings: SkillMappings;
}
