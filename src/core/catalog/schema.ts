/**
 * The vocabulary of `config.yaml`: which keys exist, and where.
 *
 * Stated once, here, so that the parser refuses what is not in these tables,
 * the resolver maps what is, and an error message names the accepted set --
 * all from the same list. A key added to the schema is a key added to one
 * array; nothing else has to learn it.
 *
 * Nothing here reads or validates: this module is the tables alone.
 */

/**
 * Schema version this build understands. A file from the future is refused
 * with an explanation rather than silently half-read.
 *
 * The reviewer has not shipped a second shape yet, so there is no migration
 * to carry: v1 is YAML with kebab-case keys, a root `defaults` section (with
 * the `llm` settings), `skills: { path, mappings }`, `language`,
 * `local-path`, and list settings as lists. The review policy is not among
 * them: it is the reviewer's own, and a project extends it through the
 * `prompts/` directory beside the catalogue (standing instructions, every
 * file) and `skills` (guidelines for the paths a mapping names).
 */
export const SCHEMA_VERSION = 1;

/** The setting keys `defaults` and a project accept, as written in the file. */
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

export type ProjectSettingKey = (typeof PROJECT_SETTING_KEYS)[number];

/** The keys of a `skills` section, as written in the file. */
export const SKILLS_SECTION_KEYS = ["path", "mappings"] as const;
export type SkillsSectionKey = (typeof SKILLS_SECTION_KEYS)[number];

/** The keys of an `llm` section, as written in the file. */
export const LLM_SECTION_KEYS = ["provider", "model", "base-url", "api-key"] as const;
export type LlmSectionKey = (typeof LLM_SECTION_KEYS)[number];
