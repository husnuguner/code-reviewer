/**
 * The vocabulary of `config.yaml`: which keys exist, at which version, and
 * what became of the ones that no longer do.
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
 * v3 drops everything about a hosting system: the reviewer reads local git,
 * so `repositories.providers`, a project's `repository` and the posting
 * settings are gone. What remains is YAML with kebab-case keys, a root
 * `defaults` section (with the `llm` settings), `skills: { path, mappings }`,
 * `language`, `local-path`, and list settings as lists. The review policy is
 * not among them: it is the reviewer's own, and a project extends it through
 * `skills`. A v2 file parses unchanged unless it names one of the removed
 * keys, which is answered by name.
 */
export const SCHEMA_VERSION = 3;

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

// -- earlier spellings, answered with the current one --------------------------

export const RENAMED_SETTING_KEYS: Readonly<Record<string, string>> = {
  lang: "language",
  skills_path: "skills.path",
  local_path: "local-path",
  localPath: "local-path",
  max_findings_per_file: "max-findings-per-file",
  maxFindingsPerFile: "max-findings-per-file",
  max_file_chars: "max-file-chars",
  maxFileChars: "max-file-chars",
  max_skill_chars: "max-skill-chars",
  maxSkillChars: "max-skill-chars",
  max_skills_total_chars: "max-skills-total-chars",
  maxSkillsTotalChars: "max-skills-total-chars",
  max_context_chars: "max-context-chars",
  maxContextChars: "max-context-chars",
  max_concurrent_files: "max-concurrent-files",
  maxConcurrentFiles: "max-concurrent-files",
};

export const RENAMED_LLM_KEYS: Readonly<Record<string, string>> = {
  baseUrl: "base-url",
  base_url: "base-url",
  apiKey: "api-key",
  api_key: "api-key",
};

/**
 * Keys the posting era owned, and what to do instead.
 *
 * Answered by name rather than as "unrecognised": an operator upgrading a v2
 * file wrote these deliberately, and "unknown setting 'severities'" would
 * read like a typo when the truth is that the feature moved out of the tool.
 */
export const REMOVED_SETTING_KEYS: Readonly<Record<string, string>> = {
  severities: "this build reports every severity; gate a run with --fail-on instead",
  "max-prior-comment-chars":
    "there is no prior discussion to read: this build reviews local git and posts nothing",
  "max-concurrent-prs":
    "one branch is reviewed per run; 'max-concurrent-files' is the remaining concurrency knob",
  prompts:
    "the review policy is the reviewer's own and cannot be replaced; add what this project needs as a skill under 'skills' (map it to ['**/*'] to apply everywhere)",
};

export const REMOVED_PROJECT_KEYS: Readonly<Record<string, string>> = {
  ...REMOVED_SETTING_KEYS,
  repository: "a project is a local checkout now; name it with 'local-path'",
  repo: "a project is a local checkout now; name it with 'local-path'",
  repo_provider: "this build talks to no hosting system; remove it",
};

export const REMOVED_ROOT_KEYS: Readonly<Record<string, string>> = {
  repositories:
    "this build talks to no hosting system: it reads local git and reports; a CI bot posts (see README, 'Why the reviewer cannot post')",
  repo_providers: "this build talks to no hosting system; remove it",
};
