# Configuration

Six layers speak, highest first:

```text
command line  ›  environment  ›  .env files  ›  <repo>/.review/config.yaml  ›  ~/.config/reviewer/config.yaml  ›  built-in default
```

They resolve into one flat settings object; nothing below the config layer
knows there are two files.

## Two files, one shape

The reviewer serves many repositories from one machine, so its settings live
in two places with one rule between them: **the machine's file says how the
reviewer runs, the repository's file says what is reviewed there** — and the
repository's file may restate any key to override the machine's for that
repository.

| File                             | Written by                         | Holds                                                                                                 |
| -------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `~/.config/reviewer/config.yaml` | `reviewer init` outside a checkout | `settings`: the model (`llm`), the findings' language, concurrency, caps. Never committed.            |
| `<repo>/.review/config.yaml`     | `reviewer init` inside a checkout  | `skills` and their mappings, plus the `settings` restated to pin them for this repository. Committed. |

Both files have two sections. **`settings`** is how the reviewer runs and is
the same set of keys in either file; **`skills`** is what the repository's
code is held to and exists only in the repository's file.

```yaml
# ~/.config/reviewer/config.yaml -- this machine
version: 1
settings:
  llm: { provider: claude, model: claude-sonnet-4-6, api-key: ANTHROPIC_API_KEY }
  language: en
  max-concurrent-files: 4
```

```yaml
# <repo>/.review/config.yaml -- this repository
version: 1
settings: # on top of the machine's
  exclude: ["**/*.spec.ts", "**/migrations/*.ts"]
  max-findings-per-file: 2
skills: # this file only
  path: skills # beside this file
  mappings:
    api-conventions: ["src/api/**/*.ts"]
```

A setting the repository's file restates wins whole; `llm` merges key by key,
so `settings: { llm: { model: claude-opus-4 } }` in the repository pins the
model and still takes the provider and the key's name from the machine.
`exclude` is replaced, not unioned. `skills` may be set only in the
repository's file: it describes the reviewed code, and the machine's file is
refused if it names it. A setting written at the root is refused with a
message pointing at the section.

### Where each file is found

`reviewer` finds `.review/config.yaml` from any subdirectory of the checkout,
the way `git` finds its repository; the checkout reviewed is the one that owns
it, else the working directory. The machine's file is
`$XDG_CONFIG_HOME/reviewer/config.yaml`, `~/.config/reviewer/config.yaml` by
default.

`--config PATH` (or `$REVIEWER_CONFIG`) puts another file in the repository's
slot; the machine's file still sits underneath. A named file that does not
exist is an error; an absent `.review/` or machine file is simply not there.

### What the repository's directory carries

```text
my-repo/
└── .review/
    ├── config.yaml        which skill applies to which paths, excludes, caps
    ├── prompts/           every *.md in here is added to every file's prompt
    │   └── prompts.md     standing instructions (written empty)
    ├── skills/            one Markdown file per convention (README explains the format)
    │   └── README.md
    └── .gitignore         keeps .review/.env (a project-specific key) out of git
```

**Commit `.review/`.** The rules are versioned with the code they govern, the
team reviews them like everything else, and a CI runner reads them from the
checkout like any other file.

The key stays out of the repository: `~/.config/reviewer/.env` for every
project, or `.review/.env` (gitignored by `init`) for one.

### On a CI runner

A runner has no `~/.config/reviewer/`, so the workflow plays the machine's
part: the action's `provider`, `model`, `base-url` and `api-key` inputs become
`LLM_*` variables, which sit above both files. Set `provider` in the workflow
unless the repository's file pins `llm.provider` itself; with neither, the
tool's default (`local`) applies. See [GitHub Action](github-action.md).

## `config.yaml`

The complete annotated reference is
[`templates/config.example.yaml`](../templates/config.example.yaml); a test
keeps it in step with the parser. `reviewer init` writes a shorter starter
([`templates/config.yaml`](../templates/config.yaml) for the machine,
[`templates/repo-config.yaml`](../templates/repo-config.yaml) for a
repository).

### Keys

Keys are kebab-case. Everything under `settings` may be set in either file;
`skills` sits at the root of the repository's file alone.

| Key                               | Default          | Machine | Repo | Meaning                                                                                     |
| --------------------------------- | ---------------- | :-----: | :--: | ------------------------------------------------------------------------------------------- |
| `settings.llm.provider`           | `local`          |    ✓    |  ✓   | `local` (any OpenAI-compatible endpoint) or `claude` (Anthropic).                           |
| `settings.llm.model`              | provider default |    ✓    |  ✓   | `local` → `gpt-4.1`, `claude` → `claude-sonnet-4-6`.                                        |
| `settings.llm.base-url`           | —                |    ✓    |  ✓   | Endpoint URL including the API prefix, e.g. `http://localhost:11434/v1`.                    |
| `settings.llm.api-key`            | _required_       |    ✓    |  ✓   | The **name** of an environment variable, or the key itself. See below.                      |
| `settings.language`               | `en`             |    ✓    |  ✓   | Language of each finding's body. Accepted: `en`, `tr`; anything else falls back to English. |
| `settings.verify`                 | `true`           |    ✓    |  ✓   | Run the [verification pass](how-it-works.md#verification).                                  |
| `settings.exclude`                | `[]`             |    ✓    |  ✓   | Globs never sent to the model; a list or one comma-separated string.                        |
| `settings.max-findings-per-file`  | `3`              |    ✓    |  ✓   | Per-file cap; the most severe survive. `0` = no cap.                                        |
| `settings.max-file-chars`         | `8000`           |    ✓    |  ✓   | Per-file cap on the diff shown; a longer diff is cut at a hunk boundary.                    |
| `settings.max-skill-chars`        | `10000`          |    ✓    |  ✓   | Cap on one skill's body.                                                                    |
| `settings.max-skills-total-chars` | `18000`          |    ✓    |  ✓   | Cap on one file's whole skills block.                                                       |
| `settings.max-context-chars`      | `6000`           |    ✓    |  ✓   | Cap on the [pre-context](how-it-works.md#pre-context) block; `0` switches it off.           |
| `settings.max-concurrent-files`   | CPU-derived      |    ✓    |  ✓   | File reviews in flight at once.                                                             |
| `skills.path`                     | `""` (no skills) |         |  ✓   | Directory of skill documents. A relative path is taken from beside the file.                |
| `skills.mappings`                 | `{}`             |         |  ✓   | Skill name → globs it reviews.                                                              |

A key the schema does not recognise is **rejected**, not ignored: the error
names the key and the accepted set. The schema is at `version: 1`; a newer
number than the build knows is refused.

A word on `settings.exclude` and `settings.language` in the machine's file: they change what the
review says, and a runner does not have that file, so a local run then differs
from CI. Rules that are the team's belong in the repository's file.

### The model's key

`settings.llm.api-key` takes either the name of an environment variable (spelled like
one: `ANTHROPIC_API_KEY`) or the value itself. Naming keeps the file
shareable; a named variable that is not set is an error at startup rather
than a 401 later.

The variable is read from the environment and from the `.env` files, in this
order (strongest first): the process environment, the repository's
`.review/.env` (a key meant for one project), the machine's
`~/.config/reviewer/.env` (where a key normally lives), and last the working
directory's `.env`. The reviewer reads these files itself; Bun's own `.env`
loading is turned off because the working directory is the checkout under
review.

### There is no key that replaces the review policy

Who the reviewer is, what it looks for, the hard rules that stop reviewed
content from steering it, and the exact JSON that comes back are all the
reviewer's own ([`prompts/system.md`](../prompts/system.md),
[`prompts/output-contract.md`](../prompts/output-contract.md)). Replacing that
text would drop a guardrail by accident.

What a project adds _on top_ has two shapes, and neither is a key:
[standing instructions](#standing-instructions) for every file, and
[skills](#review-skills) for the paths a mapping names.

## Environment

The environment is the override layer: any variable below beats its
`config.yaml` counterpart in both files. Without any file, these describe the
whole run.

| Variable                        | Default          | Purpose                                                                     |
| ------------------------------- | ---------------- | --------------------------------------------------------------------------- |
| `LLM_PROVIDER`                  | `local`          | `local` or `claude`.                                                        |
| `LLM_API_KEY`                   | _required_       | Credential; must be non-empty even for a local server.                      |
| `LLM_BASE_URL`                  | —                | Endpoint URL including the API prefix.                                      |
| `LLM_MODEL`                     | provider default | Model name.                                                                 |
| `REVIEW_LANG`                   | `en`             | Language of finding bodies.                                                 |
| `REVIEW_EXCLUDE_PATHS`          | —                | Comma-separated globs skipped entirely.                                     |
| `REVIEW_MAX_FINDINGS_PER_FILE`  | `3`              | Per-file cap; `0` = uncapped.                                               |
| `REVIEW_SKILLS_PATH`            | —                | Directory of review skills inside the reviewed repo; empty disables skills. |
| `REVIEW_SKILL_MAPPINGS`         | `{}`             | The repository's `skills.mappings` as JSON.                                 |
| `REVIEW_VERIFY`                 | `true`           | Run the verification pass. `--no-verify` wins.                              |
| `REVIEW_MAX_SKILL_CHARS`        | `10000`          | Per-skill body cap.                                                         |
| `REVIEW_MAX_SKILLS_TOTAL_CHARS` | `18000`          | Per-file cap for the whole skills block.                                    |
| `REVIEW_MAX_CONTEXT_CHARS`      | `6000`           | Cap on the pre-context block; `0` switches it off.                          |
| `REVIEW_MAX_FILE_CHARS`         | `8000`           | Per-file diff cap.                                                          |
| `REVIEW_MAX_CONCURRENT_FILES`   | CPU-derived      | Simultaneous file reviews.                                                  |
| `REVIEWER_CONFIG`               | —                | A repository `config.yaml` in place of the nearest `.review/config.yaml`.   |
| `XDG_CONFIG_HOME`               | `~/.config`      | Base of the machine's config home.                                          |

Logging variables (`REVIEWER_LOG_LEVEL`, `REVIEWER_LOG_FORMAT`, `NO_COLOR`,
…) are listed in [Output → Logging](output.md#logging).

## Standing instructions

The review policy cannot be replaced, but a repository can **add** to it:
every `*.md` under `.review/prompts/` is read, at any depth, in path order,
and appended to the system prompt for every reviewed file. `reviewer init`
writes an empty `.review/prompts/prompts.md`; filling it in is the whole of
being heard.

```text
.review/
├── config.yaml        says nothing about prompts
└── prompts/
    ├── prompts.md     read on every file
    └── security.md    read on every file, under its own heading
```

```markdown
<!-- .review/prompts/prompts.md -->

This service exposes a REST API. Every handler validates its input against
the shared schema module before touching storage; a handler that reaches into
another module's repository directly is a bug however well it works today.
```

- **Where it lands.** After the policy and its hard rules, before the output
  contract. The hard rules still stand; the contract still has the last word.
- **One heading per file.** Each file reaches the model as its own section
  titled with its path (`## prompts/security.md`), so an instruction can be
  traced back to where it came from.
- **When it applies.** Every reviewed file, every run. That is the difference
  from a skill, which applies only to the paths its mapping names.
- **What it costs.** Every file of every run pays for this text, so the whole
  directory is capped at 20 000 characters. Rules that concern some paths
  belong in a skill.
- **An empty file, or no directory, adds nothing.** The composed prompt is
  then byte-for-byte the prompt of a repository that said nothing.
- **A file that cannot be read is a warning**, not a failed run.

### The machine's prompts

`~/.config/reviewer/prompts/` holds one person's house style. It is read
**only when the repository's `.review/prompts/` says nothing** — no
directory, or only empty files. When the repository's directory holds at
least one non-empty file, that directory alone is read; the two are never
combined. The log says which one was in force.

## Review skills

A **skill** is one Markdown file of review guidelines scoped to a set of path
globs. For every changed file, the skills whose globs match are rendered into
that file's prompt under _"Project/framework standards for this file (apply IN
ADDITION to the four lenses)"_. A file that matches nothing is still reviewed,
with the four lenses alone.

The reviewer ships no skills of its own, and the machine's file may not name
any: skills are the reviewed repository's conventions, versioned with its
code. Where they are read from is `skills.path` in `.review/config.yaml`:

| `skills.path`        | Read from                                                                      |
| -------------------- | ------------------------------------------------------------------------------ |
| absolute or `~` path | that directory, as written                                                     |
| relative path        | **beside the file**: in `.review/config.yaml`, `skills` means `.review/skills` |

`--skills-path` and `REVIEW_SKILLS_PATH` come from no file and are taken from
the reviewed checkout instead.

Each skill is Markdown with YAML frontmatter; `name` is the unique id:

```markdown
---
name: api-conventions
description: Rules for HTTP handlers.
---

- Every handler validates its input with a schema before reading it.
- `req.body` is never read directly; use the validated payload.
- Authorisation happens in middleware, not inside the handler.
```

**Which files a skill reviews is stated once, in `config.yaml`:**

```yaml
skills:
  path: skills
  mappings:
    api-conventions: ["src/api/**/*.ts"]
    error-handling: "src/**/*.ts"
    background-jobs: [] # switched off without deleting the file
```

Globs use Bun's `Glob` syntax: `**` (across directories), `*` (within a
segment), `?`, `[...]` classes, `{a,b}` alternatives and `\` to escape a
wildcard. A skill's frontmatter carries `name` and `description`, nothing about
paths. A skill mapped nowhere never applies and is warned about; a mapping
naming a skill that was not loaded is warned about too. A file without valid
frontmatter (a README in the skills directory) is ignored.

Injection is capped so a wide match cannot flood the prompt: `max-skill-chars`
truncates one skill's body, `max-skills-total-chars` caps the whole per-file
block, and a skill that would overflow is skipped with an INFO log naming it.

Keep a skill short and concrete: it is read by a model for every matching
file.
