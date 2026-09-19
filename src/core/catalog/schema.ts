/**
 * The vocabulary of `config.yaml`: which keys exist, and where. Tables only.
 * @packageDocumentation
 */

/** The schema version this build understands; a newer file is refused. */
export const SCHEMA_VERSION = 1;

/** The setting keys `defaults` and a project accept. */
export const PROJECT_SETTING_KEYS = [
  "llm",
  "language",
  "verify",
  "skills",
  "local-path",
  "exclude",
  "max-findings-per-file",
  "max-file-chars",
  "max-skill-chars",
  "max-skills-total-chars",
  "max-context-chars",
  "max-concurrent-files",
] as const;

/** One of {@link PROJECT_SETTING_KEYS}. */
export type ProjectSettingKey = (typeof PROJECT_SETTING_KEYS)[number];

/** The keys of a `skills` section. */
export const SKILLS_SECTION_KEYS = ["path", "mappings"] as const;
/** One of {@link SKILLS_SECTION_KEYS}. */
export type SkillsSectionKey = (typeof SKILLS_SECTION_KEYS)[number];

/** The keys of an `llm` section. */
export const LLM_SECTION_KEYS = ["provider", "model", "base-url", "api-key"] as const;
/** One of {@link LLM_SECTION_KEYS}. */
export type LlmSectionKey = (typeof LLM_SECTION_KEYS)[number];
