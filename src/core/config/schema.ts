/**
 * The vocabulary of `config.yaml`: which keys exist, where they sit, and which of them a repository alone may
 * set. Tables only.
 * @packageDocumentation
 */

/** The schema version this build understands; a newer file is refused. */
export const SCHEMA_VERSION = 1;

/**
 * The keys of the `settings` section: how the reviewer runs. Every one is set on the machine and may be restated
 * by a repository.
 */
export const SETTINGS_SECTION_KEYS = [
  "llm",
  "language",
  "verify",
  "exclude",
  "max-findings-per-file",
  "max-file-chars",
  "max-skill-chars",
  "max-skills-total-chars",
  "max-context-chars",
  "max-concurrent-files",
] as const;

/** One of {@link SETTINGS_SECTION_KEYS}. */
export type SettingsSectionKey = (typeof SETTINGS_SECTION_KEYS)[number];

/** The keys at the root of the file, beside `version`. */
export const ROOT_KEYS = ["settings", "skills"] as const;

/** One of {@link ROOT_KEYS}. */
export type RootKey = (typeof ROOT_KEYS)[number];

/**
 * The root keys only a repository's `.review/config.yaml` may set: they describe the reviewed code, not the machine.
 */
export const REPO_ONLY_KEYS = ["skills"] as const satisfies readonly RootKey[];

/** One of {@link REPO_ONLY_KEYS}. */
export type RepoOnlyKey = (typeof REPO_ONLY_KEYS)[number];

/**
 * Every setting a file can carry, as one flat set: the `settings` section's keys plus `skills`. The parsed value
 * of a file is keyed this way, whatever section a key was written under.
 */
export const SETTING_KEYS = [...SETTINGS_SECTION_KEYS, "skills"] as const;

/** One of {@link SETTING_KEYS}. */
export type SettingKey = (typeof SETTING_KEYS)[number];

/** The keys of a `skills` section. */
export const SKILLS_SECTION_KEYS = ["path", "mappings"] as const;
/** One of {@link SKILLS_SECTION_KEYS}. */
export type SkillsSectionKey = (typeof SKILLS_SECTION_KEYS)[number];

/** The keys of an `llm` section. */
export const LLM_SECTION_KEYS = ["provider", "model", "base-url", "api-key"] as const;
/** One of {@link LLM_SECTION_KEYS}. */
export type LlmSectionKey = (typeof LLM_SECTION_KEYS)[number];
