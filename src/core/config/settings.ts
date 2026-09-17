/**
 * The typed setting groups a review run consumes.
 *
 * The flat `Config` is what the environment and the catalogue resolve into;
 * the flows read these narrower groups instead, so a flow's signature says
 * exactly which settings it depends on and a test can build one in a line.
 */

/** The slice of configuration one file review actually reads. */
export interface FileReviewSettings {
  /** Globs whose files are skipped entirely. */
  readonly exclude: readonly string[];
  /** Human language for each finding's body. */
  readonly language: string;
  /** Per-file diff/context cap fed to the model. */
  readonly maxFileChars: number;
  /** Per-skill body cap. */
  readonly maxSkillChars: number;
  /** Per-file cap for the whole skills block. */
  readonly maxSkillsTotalChars: number;
  /**
   * Cap on the pre-context block (imported modules' signatures, users of
   * changed exports, related diffs) fetched for each file; `0` = none.
   */
  readonly maxContextChars: number;
}

export const DEFAULT_FILE_REVIEW_SETTINGS: FileReviewSettings = {
  exclude: [],
  language: "English",
  maxFileChars: 8000,
  maxSkillChars: 10_000,
  maxSkillsTotalChars: 18_000,
  maxContextChars: 6000,
};

/**
 * How many findings one file is allowed to report.
 *
 * A volume policy, not a judgement: the model may legitimately find eleven
 * things in one file, and a report listing all eleven is a report nobody
 * reads. The cap keeps the most severe and *counts* the rest, so a run can
 * still say how many it withheld -- a finding dropped in silence is the one
 * failure mode this policy must not have.
 */
export interface ReportPolicy {
  /** Max findings reported per file; the most severe survive. `0` = uncapped. Default 3. */
  readonly maxFindingsPerFile: number;
}

export const DEFAULT_REPORT_POLICY: ReportPolicy = {
  maxFindingsPerFile: 3,
};

/** How much runs at once. */
export interface ConcurrencyLimits {
  /** Global cap on simultaneous file reviews (content read + model call). */
  readonly files: number;
}

/**
 * Which files each skill reviews: skill name -> path globs. Set per project
 * in the catalogue, and nowhere else. An empty list switches the skill off; a
 * skill mapped nowhere never applies.
 */
export type SkillMappings = Readonly<Record<string, readonly string[]>>;

/** Where a project's skills are and what each one applies to. */
export interface SkillSettings {
  /** Repo-relative directory of the skill documents; `""` = no skills. */
  readonly path: string;
  readonly mappings: SkillMappings;
}

/**
 * The review policy an operator has written: files whose text, in order,
 * replaces the shipped policy half of the system prompt. Relative paths are
 * resolved against the catalogue's directory. Empty = the shipped policy.
 */
export type PromptFiles = readonly string[];
