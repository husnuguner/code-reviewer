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
  /** Per-file cap on the diff shown to the model. */
  readonly maxFileChars: number;
  /** Per-skill body cap. */
  readonly maxSkillChars: number;
  /** Per-file cap for the whole skills block. */
  readonly maxSkillsTotalChars: number;
  /** Cap on the pre-context block; `0` = none. */
  readonly maxContextChars: number;
}

/** The built-in file review settings. */
export const DEFAULT_FILE_REVIEW_SETTINGS: FileReviewSettings = {
  exclude: [],
  language: "English",
  maxFileChars: 8000,
  maxSkillChars: 10_000,
  maxSkillsTotalChars: 18_000,
  maxContextChars: 6000,
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

/** Where a project's skills are and what each applies to. */
export interface SkillSettings {
  /** Directory of the skill documents; `""` = no skills. */
  readonly path: string;
  readonly mappings: SkillMappings;
}
