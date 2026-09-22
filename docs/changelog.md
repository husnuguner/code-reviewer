# Changelog

One section per release, newest first, headed `## vX.Y.Z` and nothing else on
the line. When a commit on `main` bumps `package.json` to a version that has no
GitHub Release yet, the `Release` workflow (`.github/workflows/release.yml`)
publishes one with that version's section as its notes, and fails when there is
none — so the section is written beside the version bump. What is in a section
is what a user of the action or the CLI has to know; the commit log has the
rest.

## v0.0.11

No change to the reviewer, the actions or the NDJSON contract. This release is about how releases
are made.

- **A pushed tag is a release.** The `Release` workflow checks the tagged commit against the tag
  (`package.json`'s version, a changelog section), publishes the GitHub Release with that section
  as its notes and moves `v0` to it. Releasing is a version bump, a changelog section, a tag.
- **The changelog is in the repository.** `docs/changelog.md` holds every release's notes, this
  one and all before it; the three tags that never had a GitHub Release (`v0.0.1`, `v0.0.2`,
  `v0.0.9`) have a paragraph each.
- **The examples pin `@v0`.** The README and the action page reference the actions by the moving
  major tag instead of one release, so they stay true as tags land; a test refuses an exact version
  there. Pinning a release still works exactly as before: take a `vX.Y.Z` from the Releases page.

## v0.0.10

### What's new

- **Bypass a block from the code.** A comment reading `reviewer: by-pass - <reason>` takes the
  block after it (a function, an `if`, a class, a Python `def`) out of review. The reason is
  required; every run names the regions it honoured in the text report, the job summary and the
  posted comment. Findings inside a region are dropped before verification; a file whose every
  added line is bypassed calls no model. New setting `settings.bypass-markers` (default `true`, no
  environment alias). New summary fields `bypassed`, `bypass_regions`; new skip reason `bypassed`.
- **No repeated inline comments.** `reviewer comment` asks GitHub for the inline comments earlier
  runs left and does not post a finding again on a line one of them already covers (same line, or
  a range overlapping by more than 60%). Positions are GitHub's current ones, so a comment that
  moved with the branch still counts and an outdated one does not. Every inline comment carries an
  invisible `<!-- code-reviewer -->` marker. `--allow-duplicates` (action input
  `allow-duplicates`) switches the check off.
- **Review only what a push added.** `reviewer review --since <ref>` reviews the diff `ref..HEAD`.
  The review action gains `incremental: true`: on a `synchronize` event it reviews from
  `github.event.before`, and falls back to the whole range on any doubt (force-push, base merged
  in, another event), saying why in `range-reason`. The summary carries `incremental: true`;
  `reviewer comment` then leaves earlier verdicts standing instead of superseding them.

### NDJSON contract (0.x may change it)

Summary gains `incremental`, `bypassed` and `bypass_regions`; `skipped` may carry `bypassed`.
Readers written for 0.0.9 keep working: the fields are additive.

### Also

- Pre-context budget is one `settings.context` section; `max-skill-chars` is `skills.max-chars`.
- Member blocks in pre-context survive a brace in a string and a wrapped signature.

## v0.0.9

No GitHub Release was published for this tag.

- **A skills baseline, stated once.** `skills.defaults` is a list of `{ globs, skills }` entries
  naming the skills every file a glob matches is held to; `skills.mappings` adds to that baseline
  and `[]` still switches a skill off.
- A skill the per-file budget leaves out is now a warning naming the file, the cap and the skill,
  once a run. Settings that are each legal and together contradict are warned about at startup.
- The documentation pages were brought back in step with the code.

## v0.0.8

No behaviour change; one warning gone.

### Claude is no longer asked for a JSON mode it does not have

Every call to Anthropic logged
`AI SDK Warning: The feature "responseFormat" is not supported. JSON response format requires a schema.`
The adapter asked every vendor for the schema-less JSON mode (`response_format: json_object`);
Anthropic's provider knows only the schema-bound kind, ignored the request and said so on each
call. The reviewer's own parser read the answer either way.

The vendor class now says whether such a mode exists, the way it already says what a stable prefix
means: OpenAI-compatible endpoints are still asked for JSON mode; Claude is asked for nothing, and
the log is quiet. Findings, anchoring and verification are unchanged.

## v0.0.7

**Breaking, three ways: a key must be written `${VARIABLE}` to read the environment, every command
must be named (`reviewer review …`), and `--uncommitted` refuses `--base`/`--branch`. Details and
the one-line fixes below.**

### Reading the environment from a file is explicit: `${VARIABLE}`

A setting spelled like a variable's name used to be guessed as one. It is now said outright,
anywhere in a string value, with [dotenv-expand](https://github.com/motdotla/dotenv-expand)'s
rules:

```yaml
settings:
  llm:
    api-key: ${ANTHROPIC_API_KEY} # the whole value
    base-url: ${LLM_HOST:-http://localhost:11434}/v1 # inside a string, with a default
```

The variable's name is yours; `ANTHROPIC_API_KEY` is an example, not something the reviewer knows
about. A reference the environment cannot answer is refused at startup and named by its setting
(`settings.llm.api-key reads '${ANTHROPIC_API_KEY}', which is not set`), except the key under
`--preview`, which calls no model. A key written as a bare name (`api-key: ANTHROPIC_API_KEY`) is
refused with the spelling that reads it — a key never looks like that, so the `${}` was forgotten.

**Fix:** wrap the name: `api-key: ${ANTHROPIC_API_KEY}`.

### The schema, merging and precedence are convict's

The reviewer carried its own configuration engine; [convict](https://github.com/mozilla/node-convict)
does that work now, from one table of settings (default, environment variable, format, doc). What
you see of it:

- Every problem in a file is reported at once, each named by its path in the file:
  `settings.llm.provider: must be one of ['claude', 'local'], got: 'gemini'`,
  `configuration param 'settings.exlude' not declared in the schema`.
- Nothing else changes: the repository's file still sits on the machine's, `llm` still merges key
  by key, lists are still replaced whole, the environment still beats both files, the command line
  beats everything.

### Every command is named

`reviewer --base main` no longer means `reviewer review --base main`; there is no default command.
A bare `reviewer`, or a flag without its command, prints the help and exits 1.

**Fix:** `reviewer review …`, `reviewer init`, `reviewer comment …`. The action passes `review`
itself.

### `--uncommitted` refuses `--base` and `--branch`

A working-tree review compares against `HEAD`; a base or branch named alongside was never read.
Naming one is now a usage error rather than a flag that does nothing.

## v0.0.6

**Breaking: `config.yaml` has a new shape and the project catalogue is gone. A
`.review/config.yaml` written for 0.0.5 is refused; the section below says what to move where.**

### The machine's file says how, the repository's says what

The reviewer serves many repositories from one machine, so its configuration now lives in two
files of one shape instead of one catalogue of projects:

| File                             | Holds                                                                                                                                                      |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `~/.config/reviewer/config.yaml` | `settings`: the model (`llm`), the findings' language, caps, concurrency. Written once per machine by `reviewer init` outside a checkout. Never committed. |
| `<repo>/.review/config.yaml`     | `skills` and their mappings, plus whatever `settings` the repository restates for itself. Written by `reviewer init` inside a checkout. Committed.         |

The repository's file sits on top of the machine's: a restated setting wins, and `llm` merges key
by key, so `settings: { llm: { model: claude-opus-4 } }` pins the model and still takes the
provider and the key's name from the machine. `skills` describes the reviewed code and is refused
in the machine's file; a setting written at the root is pointed at the `settings` section. The
environment (`LLM_*`, `REVIEW_*`) still beats both files.

```yaml
# ~/.config/reviewer/config.yaml
version: 1
settings:
  llm: { provider: claude, model: claude-sonnet-4-6, api-key: ANTHROPIC_API_KEY }
  language: en

# <repo>/.review/config.yaml
version: 1
settings:
  exclude: ["**/*.spec.ts", "**/migrations/*.ts"]
  max-findings-per-file: 3
skills:
  path: skills
  mappings:
    api-conventions: ["src/api/**/*.ts"]
```

### Moving a 0.0.5 file

- Keys under `defaults` move under `settings`; `projects.<name>.skills` moves to the root as
  `skills`.
- `llm` normally leaves the repository's file: on a developer's machine
  `~/.config/reviewer/config.yaml` names the model (run `reviewer init` outside a checkout to write
  it), and on a runner the workflow does — **set the action's `provider` (and `model`) inputs**,
  since a runner has no machine file and an empty `provider` falls back to `local`. Restate
  `settings.llm` in the repository only to pin it.
- Gone, with nothing to select from: `--project`, `reviewer add`, `reviewer projects`, the action's
  `project` input, `local-path`, `REVIEW_LOCAL_PATH`, `{{project}}` and the legacy `config.json`.
  The checkout reviewed is the one owning `.review/config.yaml`, else the working directory.

### Standing instructions fall back

`~/.config/reviewer/prompts/` is now read — but only when the repository's `.review/prompts/` says
nothing (no directory, or only empty files). When the repository's holds a non-empty file, that
directory alone is read; the two are never combined, and the log says which was in force.

## v0.0.5

**If you are pinned to `v0.0.3` or `v0.0.4`, move: the review action could not review anything on
those.**

### The review action reached its command

Every ordinary call of `actions/review` failed with exit 1, no findings, no output and no error
text, within milliseconds — before the reviewer was ever spawned.

`shell: bash` is not plain bash: the runner spawns `bash --noprofile --norc -e -o pipefail <script>`,
so errexit is on before the step's first line and the step's own `set -uo pipefail` does not undo
it. The step's guard for an unset optional input was a function ending in a false test, which
returns 1 — and under errexit that ends the step. Every optional input of the action defaults to
the empty string, so the very first guard (`provider`, unset in the common case) was enough to kill
the run.

Errexit is now off deliberately, for two reasons: a guard that declines is an answer, not a
failure, and the step reads the reviewer's own `$?` and exits on it — which errexit made
impossible, so a `--fail-on` that bit would have killed the step before its outputs were written.

Both actions' step scripts are now run in the test suite under that exact shell, with the command
stubbed on the PATH: a step that cannot reach its command now fails here instead of in someone
else's CI.

### A run says what it cost

- Each file's `review` line carries the wall time of every step it waited on:
  `context 0.2s, model 77.7s, verify 18.1s`.
- `-v` adds one line per model call with tokens in, tokens out and the rate between them — what
  separates a long answer (the reviewer asking for too much) from a slow vendor.
- Verbose timestamps are now `HH:MM:SS.mmm` in your own time zone; `--log-format json` still
  carries the full UTC instant.

### A run pays for its reused prefix once

The standing prompt and each skills block are now sent ahead of the file's own text and marked
stable, so Anthropic's prompt caching keeps them: a twenty-file pull request pays for that prefix
once instead of twenty times. OpenAI-compatible endpoints are told nothing and behave as before.
The token line (`9,445 tokens in (7,650 cached)`) is the only place a cache hit is visible.

### The findings cap is told to the model

`max-findings-per-file` is now in the prompt as well as applied after the call, in the reviewer's
own severity order, with an instruction not to shorten or merge findings to fit. A file with a
dozen problems and a cap of three no longer pays to generate nine findings it will throw away. The
cut afterwards still stands — the model is asked, not trusted — so `capped` now says how often it
overran.

## v0.0.4

### Breaking: the catalogue schema starts over at v1

A repository no longer **names** its prompt files. Every `*.md` under the `prompts/` directory
beside the catalogue is read, at any depth, in path order, so there is no key to set:

```text
.review/
├── config.yaml        says nothing about prompts
└── prompts/
    ├── prompts.md     read on every file
    └── security.md    read on every file, under its own heading
```

The `prompts` key is gone, and with it the renames and removals the schema was carrying for shapes
that never shipped. A `config.yaml` written by an earlier build therefore stops parsing, and says
so by name:

```console
error: .review/config.yaml declares schema version 3, but this build
understands up to 1. Upgrade the reviewer.
```

Two lines of migration: set `version: 1`, and move whatever `prompts:` used to name into
`.review/prompts/`. The leading zero is doing its job here — a config file breaks, and that is what
a 0.x release is allowed to do.

### A working tree is a change set too

`reviewer --uncommitted` reviews what is on disk against `HEAD` instead of a branch against a base:

```bash
reviewer --uncommitted --preview   # scope only: no model, no cost
reviewer --uncommitted --fail-on bug,security
```

Staged **and** unstaged work on tracked files arrives as one patch — staging is a step towards a
commit, not a verdict on what is finished, so a review that saw one side would review a change
nobody made. Untracked files are invisible to every `git diff` against a ref, so each is read as a
patch against nothing and git decides what a new file's diff looks like: its mode, its binary-ness,
its missing final newline. `.gitignore` is obeyed, an embedded repository is not descended into,
and a repository with no commit at all is compared against the empty tree rather than failing on a
`HEAD` that does not exist.

`--base` and `--branch` describe a comparison such a run never makes, so the summary reports what
was actually compared — `base: "HEAD"`, `branch: "working tree"` — and no record can claim a diff
that was not taken.

It answers the commonest surprise a branch review has to offer: **a branch with no commits of its
own reviews nothing.** Work that is still uncommitted, or a branch already merged into its base
(the merge-base _is_ `HEAD`), leaves the three-dot diff empty, and until now the run could only say
`0 changed file(s)` and leave the author to work out why.

### Fixed: paths git would otherwise quote

A non-ASCII path arrived from `git diff` as `"src/\303\274.ts"`, which names no file on disk — so
the file was read as one nobody could open and every finding anchored to it pointed nowhere. Every
diff this takes now reads paths as bytes.

## v0.0.3

### Breaking: the actions moved

Both halves now live under `actions/`, so the review action is no longer the repository root:

```yaml
- uses: husnuguner/code-reviewer/actions/review@v0.0.3
- uses: husnuguner/code-reviewer/actions/comment@v0.0.3
```

A workflow pinned to `husnuguner/code-reviewer@v0` or `@v0.0.2` stops resolving until its `uses:`
line is updated. Inputs and outputs are unchanged.

### The poster is an action again

`actions/comment` replaces the four steps a workflow had to repeat (checkout, setup-bun, install,
run). Its inputs are `reviewer comment`'s flags, and a test fails the moment the two stop matching:
a flag the action does not take, an input it never forwards, a default that drifts, or anything
besides `token` marked required.

### A repository may add to the review policy

`prompts` names files whose text is **appended** to the policy — after the hard rules, before the
output contract — for every reviewed file. `reviewer init` writes an empty
`.review/prompts/prompts.md` and the starter catalogue names it; filling it in is the whole of
being heard, and leaving it empty composes exactly the prompt of a project that named none. Capped
at 20 000 characters; rules that concern only some paths still belong in a skill.

### Fix

The review action's base-ref guard matched with `grep`, which reads lines, so a value whose _first_
line looked like a ref passed. It matches the whole value now.

## v0.0.2

No GitHub Release was published for this tag.

- **The poster is a command, not an action.** `comment-action/` is gone; the workflow runs
  `reviewer comment` directly. (`actions/comment` returns in v0.0.3.)
- **The review policy is the reviewer's own.** The `prompts` key that could replace the policy half
  of the system prompt is gone; the policy gains the hard rules that were missing, and a project's
  own rules arrive as skills.
- `templates/` holds the catalogue samples and the annotated reference, and ships with the package.
- This repository no longer reviews itself with its own action.

## v0.0.1

No GitHub Release was published for this tag.

The version line starts over at `0.0.1`: an immutable `vX.Y.Z` per release and a moving `v0` that
follows the latest `0.x`. While the major is `0`, any release may change the action's inputs or
the NDJSON contract; `1.0.0` is the release that turns both into promises. The code is the review
engine, providers layer and retry policy as they stood on 2026-09-18.
