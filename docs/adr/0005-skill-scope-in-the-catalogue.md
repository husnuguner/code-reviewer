# A project's catalogue says which files each skill reviews

Catalogue schema version 2. Supersedes the frontmatter-only scoping described
in [ADR 0003](0003-no-bundled-skill-library.md); the rest of that decision
stands.

## Context

A skill is a Markdown file of review rules. Until now the file itself declared
which paths it applies to, in an `applies_to` frontmatter list, and the
reviewer had no say: whoever edited the skill decided its scope.

Two things went wrong with that in use. The scope of a skill is a **project**
decision — the same `medusa-route` rules apply to `src/api/**/route.ts` in one
repository and `apps/*/api/**/route.ts` in another, and one project wants
`medusa-links` off while keeping the file for reference. Encoding that in the
skill meant forking the skill per project, or editing a shared library file to
change one project's behaviour. And the mapping was invisible from the place
where everything else about a project is stated: the catalogue.

At the same time the catalogue carried two Python-era papercuts: the key for
the inline-comment policy was `inline_severities` (the "inline" is what every
severity setting is about), and optional values were being written as `null`
where omitting them means the same thing.

## Decision

Schema version 2 of the catalogue (`config.yaml`; see [ADR 0007](0007-one-yaml-catalogue.md) for the format):

- **`projects.<name>.skills`** is one section: `path` (the directory in the
  reviewed repository; was the flat `skills_path`) and `mappings`, a map of
  skill name to glob or list of globs. This is the **only** place a skill's
  scope is stated: a skill mapped nowhere never applies (and is warned about,
  since a loaded skill nobody can reach is almost always a forgotten line);
  an empty list switches a skill off; a mapping naming a skill that was not
  loaded is a warning too (it is almost always a typo).
- **`applies_to` in the frontmatter is not read.** It was, briefly, kept as a
  fallback -- and a fallback is a second place for the same decision, which
  means one of the two eventually lies. A document that still carries the key
  is parsed and warned about, so its author learns where the scope lives now
  rather than wondering why the skill never fires. The parser keeps a skill
  that has no scope; the catalogue gives it one.
- **`skills.path` may be local.** An absolute or `~` path names a directory
  on the reviewer's machine (the usual home is
  `~/.config/reviewer/skills/{{project}}`, `{{project}}` standing for the
  project's name so one shared default gives each project its own folder),
  read the same way in every flow; a relative path keeps ADR 0003's meaning
  -- inside the reviewed repository, at the PR head or in the worktree.
- **A root `defaults` section** holds the review settings every project
  starts from. A project overrides a key by restating it. Precedence:
  project > `defaults` > built-in default. `skills.mappings` is the one key
  `defaults` refuses: which files a skill reviews depends on a project's
  layout, so it is stated on the project (`skills.path` may be shared). The
  built-in cap on inline comments per file is 3 (was 0 = uncapped).
- **`prompts`** lists the review-policy files; see
  [ADR 0006](0006-review-policy-is-a-file.md).
- **Keys are kebab-case** (`max-findings-per-file`, `base-url`), as YAML is
  usually written. **`repositories.providers`** replaces the root `repo_providers`;
  **`auth.token`** replaces `token_env` (it still names the variable, never
  the secret). In a project, **`repository: { provider, name }`** replaces
  the flat `repo_provider` and `repo`, and **`language`** replaces `lang`.
- **`severities`** replaces `inline_severities`. A file still using an old
  name (`repo_providers`, `token_env`, `base_url`, `repo_provider`, `repo`,
  `lang`, `skills_path`, `inline_severities`, the snake_case `max_*`) is
  refused with
  the new name in the message, not with a generic "unrecognised setting".
- List-valued settings (`exclude`, `severities`) are written as lists; a
  comma-separated string is still accepted.
- Optional keys are omitted rather than set to `null`; the skeleton `init`
  writes and the reference example do the same.
- `SCHEMA_VERSION` is 2. A file that declares no version is read as the
  current one, as before.

The mappings flow through the same path as every other setting: catalogue
`skills.mappings` → `Config` field (`skillMappings`, alias
`REVIEW_SKILL_MAPPINGS` as JSON in the environment) → `Config.skillSettings()`
→ `SkillRegistry.build(..., mappings)`. Nothing below the registry knows where
a skill's globs came from.

The complete, annotated catalogue is `docs/config.example.yaml`; a test parses
it and checks that it names every project setting the schema accepts and every
skill of the shipped Medusa library, so the reference cannot drift.

## Consequences

- This is the first deliberate break with the Python reference's file format.
  The `catalog` and `commands` fixture files are maintained by hand from v2 on
  (they carry a `schema` note saying so); every other fixture file is still a
  generated snapshot. The `skills` parser fixture is regenerated from this
  parser: every parsed skill has `globs: []`, because a document has no scope
  of its own. (Python read `applies_to` and dropped a skill without it.)
- The shipped Medusa skills no longer carry `applies_to`; the library's
  mapping lives in the example catalogue. Using the library means copying the
  files to `skills.path` and the `skills.mappings` block into `defaults`.
- The `config` fixture's expected default for `max_findings_per_file` is 3
  where the environment does not set it (Python: 0).
- A skill switched off by `[]` still costs a fetch in PR review (the directory
  listing is read as a whole); this is deliberate — the alternative was to
  read the catalogue inside the skill source, which is the wrong direction.
