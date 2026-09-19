# Configuration

Five layers speak, highest first:

```text
command line  ›  environment  ›  .env files  ›  config.yaml project  ›  config.yaml defaults  ›  built-in default
```

They resolve into one flat settings object; nothing below the config layer
knows a catalogue exists.

## Where a project's rules live

`reviewer init`, run inside a git checkout, writes the project's review setup
into that checkout:

```text
my-repo/
└── .review/
    ├── config.yaml        which skill applies to which paths, the model, excludes
    ├── prompts/           every *.md in here is added to every file's prompt
    │   └── prompts.md     standing instructions (written empty)
    ├── skills/            one Markdown file per convention (README explains the format)
    │   └── README.md
    └── .gitignore         keeps .review/.env (a project-specific key) out of git
```

**Commit `.review/`.** The rules are versioned with the code they govern, the
team reviews them like everything else, and a CI runner reads them from the
checkout like any other file.

`reviewer` finds `.review/config.yaml` from any subdirectory of the checkout,
the way `git` finds its repository. Precedence when more than one could apply:

```text
--config PATH  ›  $REVIEWER_CONFIG  ›  <checkout>/.review/config.yaml  ›  ~/.config/reviewer/config.yaml
```

The key stays out of the repository: `~/.config/reviewer/.env` for every
project, or `.review/.env` (gitignored by `init`) for one.

### Machine-wide catalogue

For repositories that carry no rules of their own, or for one person's rules
that are not the team's, `reviewer init` run _outside_ a checkout writes
`~/.config/reviewer/config.yaml` instead. `reviewer add <name>` (from inside a
checkout) defines a project in it, and `reviewer projects` lists what the
catalogue in force defines. Everything below applies to both homes.

`$XDG_CONFIG_HOME/reviewer` moves the machine-wide home under another base.

## `config.yaml`

The complete annotated reference is
[`templates/config.example.yaml`](../templates/config.example.yaml); a test
keeps it in step with the parser. `reviewer init` writes a shorter starter
([`templates/config.yaml`](../templates/config.yaml) or
[`templates/repo-config.yaml`](../templates/repo-config.yaml)). The shape, at
its smallest useful:

```yaml
version: 1
defaults:
  llm: { provider: claude, model: claude-sonnet-4-6, api-key: ANTHROPIC_API_KEY }
  language: en
  exclude: ["**/*.spec.ts", "**/migrations/*.ts"]
projects:
  app:
    skills:
      path: skills # beside config.yaml
      mappings:
        api-conventions: ["src/api/**/*.ts"]
        error-handling: "src/**/*.ts"
    max-findings-per-file: 2
```

Two sections: **`defaults`** (what every project starts from) and
**`projects`** (each a checkout plus whatever it overrides). A key set on the
project wins over `defaults`, which wins over the built-in default; `llm`
merges key by key.

A project is a _checkout_, not a repository on a hosting system:
`local-path` names it, and omitting it reviews the current directory, which is
what a CI job wants after `actions/checkout`.

### Setting keys

Valid under `defaults` and under each project. Keys are kebab-case.

| Key                      | Default           | Meaning                                                                                     |
| ------------------------ | ----------------- | ------------------------------------------------------------------------------------------- |
| `llm.provider`           | `local`           | `local` (any OpenAI-compatible endpoint) or `claude` (Anthropic).                           |
| `llm.model`              | provider default  | `local` → `gpt-4.1`, `claude` → `claude-sonnet-4-6`.                                        |
| `llm.base-url`           | —                 | Endpoint URL including the API prefix, e.g. `http://localhost:11434/v1`.                    |
| `llm.api-key`            | _required_        | The **name** of an environment variable, or the key itself. See below.                      |
| `language`               | `en`              | Language of each finding's body. Accepted: `en`, `tr`; anything else falls back to English. |
| `verify`                 | `true`            | Run the [verification pass](how-it-works.md#verification).                                  |
| `skills.path`            | `""` (no skills)  | Directory of skill documents. Relative paths are taken from beside the catalogue.           |
| `skills.mappings`        | `{}`              | Skill name → globs it reviews. **Project only**, never a default.                           |
| `local-path`             | current directory | The checkout to review.                                                                     |
| `exclude`                | `[]`              | Globs never sent to the model; a list or one comma-separated string.                        |
| `max-findings-per-file`  | `3`               | Per-file cap; the most severe survive. `0` = no cap.                                        |
| `max-file-chars`         | `8000`            | Per-file cap on the diff shown; a longer diff is cut at a hunk boundary.                    |
| `max-skill-chars`        | `10000`           | Cap on one skill's body.                                                                    |
| `max-skills-total-chars` | `18000`           | Cap on one file's whole skills block.                                                       |
| `max-context-chars`      | `6000`            | Cap on the [pre-context](how-it-works.md#pre-context) block; `0` switches it off.           |
| `max-concurrent-files`   | CPU-derived       | File reviews in flight at once.                                                             |

`{{project}}` in `skills.path` and `local-path` stands for the project's name.

A key the schema does not recognise is **rejected**, not ignored: the error
names the key and the accepted set. The schema is at `version: 1`; a newer
number than the build knows is refused.

### The model's key

`llm.api-key` takes either the name of an environment variable (spelled like
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
`config.yaml` counterpart for every project. Without a catalogue, these
describe the whole run.

| Variable                        | Default          | Purpose                                                                     |
| ------------------------------- | ---------------- | --------------------------------------------------------------------------- |
| `LLM_PROVIDER`                  | `local`          | `local` or `claude`.                                                        |
| `LLM_API_KEY`                   | _required_       | Credential; must be non-empty even for a local server.                      |
| `LLM_BASE_URL`                  | —                | Endpoint URL including the API prefix.                                      |
| `LLM_MODEL`                     | provider default | Model name.                                                                 |
| `REVIEW_LOCAL_PATH`             | the cwd          | The checkout to review.                                                     |
| `REVIEW_LANG`                   | `en`             | Language of finding bodies.                                                 |
| `REVIEW_EXCLUDE_PATHS`          | —                | Comma-separated globs skipped entirely.                                     |
| `REVIEW_MAX_FINDINGS_PER_FILE`  | `3`              | Per-file cap; `0` = uncapped.                                               |
| `REVIEW_SKILLS_PATH`            | —                | Directory of review skills inside the reviewed repo; empty disables skills. |
| `REVIEW_SKILL_MAPPINGS`         | `{}`             | The project's `skills.mappings` as JSON.                                    |
| `REVIEW_VERIFY`                 | `true`           | Run the verification pass. `--no-verify` wins.                              |
| `REVIEW_MAX_SKILL_CHARS`        | `10000`          | Per-skill body cap.                                                         |
| `REVIEW_MAX_SKILLS_TOTAL_CHARS` | `18000`          | Per-file cap for the whole skills block.                                    |
| `REVIEW_MAX_CONTEXT_CHARS`      | `6000`           | Cap on the pre-context block; `0` switches it off.                          |
| `REVIEW_MAX_FILE_CHARS`         | `8000`           | Per-file diff cap.                                                          |
| `REVIEW_MAX_CONCURRENT_FILES`   | CPU-derived      | Simultaneous file reviews.                                                  |
| `REVIEWER_CONFIG`               | —                | Path to `config.yaml`, overriding the default location.                     |
| `XDG_CONFIG_HOME`               | `~/.config`      | Base of the machine-wide home.                                              |

Logging variables (`REVIEWER_LOG_LEVEL`, `REVIEWER_LOG_FORMAT`, `NO_COLOR`,
…) are listed in [Output → Logging](output.md#logging).

## Standing instructions

The review policy cannot be replaced, but a repository can **add** to it:
every `*.md` under the `prompts/` directory **beside the catalogue** is read,
at any depth, in path order, and appended to the system prompt for every
reviewed file. `reviewer init` writes an empty `.review/prompts/prompts.md`;
filling it in is the whole of being heard.

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

A machine-wide catalogue's directory is `~/.config/reviewer/prompts/`: one
shared house style for every project reviewed without a `.review/` of its own.

## Review skills

A **skill** is one Markdown file of review guidelines scoped to a set of path
globs. For every changed file, the skills whose globs match are rendered into
that file's prompt under _"Project/framework standards for this file (apply IN
ADDITION to the four lenses)"_. A file that matches nothing is still reviewed,
with the four lenses alone.

The reviewer ships no skills of its own. Where they are read from is
`skills.path`:

| `skills.path`        | Read from                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------ |
| absolute or `~` path | that directory, as written; the machine-wide home is `~/.config/reviewer/skills/<project>` |
| relative path        | **beside the catalogue file**: in `.review/config.yaml`, `skills` means `.review/skills`   |

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
