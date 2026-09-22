# code-reviewer

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/tag/husnuguner/code-reviewer?label=release&sort=semver)](https://github.com/husnuguner/code-reviewer/tags)
[![Bun](https://img.shields.io/badge/bun-%E2%89%A5%201.4-black?logo=bun)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)

An on-demand code-review agent for one repository. It reads a change set from
**local git**, reviews every changed file with an LLM through four lenses
(bug, security, performance, readability) **plus your project's own
conventions**, and reports findings anchored to the lines they are about.

It posts nothing and holds no repository credential. Turning findings into
pull-request comments is a separate command, in a separate CI job, that runs
no model.

```text
$ reviewer review --base main

=== Branch review: HEAD vs main ===
2 finding(s) across 1 file(s).

src/api/users/handler.ts:41
  **[Bug/correctness]** `req.body` is read directly; the validated payload is
  `req.validatedBody`. A client can send fields the schema never allowed.
  (skills: api-conventions)

src/api/users/handler.ts:58
  **[Performance]** `users.findAll()` is called inside the loop; hoist it or
  pass the ids as one query.
```

## Table of contents

- [Features](#features)
- [How it works](#how-it-works)
- [Requirements](#requirements)
- [Installation](#installation)
- [Quick start](#quick-start)
- [Usage](#usage)
- [Configuration](#configuration)
- [Review skills](#review-skills)
- [GitHub Action](#github-action)
- [Security model](#security-model)
- [Documentation](#documentation)
- [Development](#development)
- [Contributing](#contributing)
- [Versioning](#versioning)
- [License](#license)

## Features

- **Local git in, findings out.** Reviews the checkout against a base
  (`base...HEAD`) or the uncommitted working tree. No hosting API, no token, no
  daemon.
- **Your conventions, per path.** A library of Markdown _skills_ mapped to
  globs is injected into the prompt of the files they cover.
- **Standing instructions.** Every `*.md` under `.review/prompts/` is added to
  every file's prompt.
- **Anchored findings.** Each finding is placed by two independent signals
  (the line number and a verbatim quote) and repaired when one is wrong.
- **Verified findings.** A second pass drops findings the diff itself refutes.
  It can only remove, never invent or re-rate, and fails open.
- **Bypass from the code.** A comment reading `reviewer: by-pass - <reason>`
  takes the block after it out of review; every run names the regions it
  honoured, so a bypass is a visible decision.
- **Nothing dropped in silence.** Skipped, refuted, capped, mislabelled,
  bypassed and unanchored are all counted in the summary.
- **Free preview.** `--preview` prints exactly what would be reviewed, and
  why the rest would not, without calling a model.
- **Three output formats.** Text for a terminal, NDJSON for a program, GitHub
  annotations for a runner — plus `--out` for a machine copy alongside any of
  them.
- **Any OpenAI-compatible endpoint or Anthropic**, through the
  [AI SDK](https://ai-sdk.dev). Prompt caching is used where the vendor offers
  it.
- **CI-ready.** Two composite actions: one reviews with `contents: read`, the
  other posts with `pull-requests: write`. No job holds both.

## How it works

```text
local git ──▶ select ──▶ per file: context ▸ model ▸ anchor ▸ verify ──▶ cap ──▶ report
              (pure)      (parallel, bounded)                             (stream)
```

1. The change set is read from local git (three-dot diff, or the working tree).
2. One pure function decides which files are reviewed; every skip carries a
   reason. `--preview` prints this and stops.
3. Each selected file is reviewed in parallel: its skills are matched, its
   full text and surrounding code are fetched, the model is asked once, each
   finding is anchored, and the findings are verified against the diff.
4. Per-file volume is capped (most severe survive) and records are streamed
   to the reporter as each file finishes, followed by one summary.

The full walk-through, including anchoring, verification and what is never
sent to the model, is in [docs/how-it-works.md](docs/how-it-works.md).

## Requirements

- [Bun](https://bun.sh) ≥ 1.4
- `git` on `PATH`
- An LLM: an Anthropic API key, or any OpenAI-compatible endpoint (Ollama, LM
  Studio, vLLM, OpenAI, …)

No GitHub token is needed to review. One is needed only by the optional
`comment` command that posts.

## Installation

```bash
bun install -g github:husnuguner/code-reviewer
```

There is nothing to build; Bun runs the TypeScript as it is. To work from a
clone instead:

```bash
git clone https://github.com/husnuguner/code-reviewer.git
cd code-reviewer && bun install && bun link   # `reviewer` on PATH from src/
```

## Quick start

```bash
# 1. The model, once per machine (never committed)
cd ~ && reviewer init            # writes ~/.config/reviewer/config.yaml: provider, model, the key's name
printf 'ANTHROPIC_API_KEY=sk-ant-...\n' > ~/.config/reviewer/.env && chmod 600 ~/.config/reviewer/.env

# 2. In the repository you want reviewed
cd ~/work/my-repo
reviewer init                    # writes ./.review/ — config, prompts/, skills/
reviewer review --preview --base main   # what would be reviewed; no model call, no cost
reviewer review --base main             # the review
```

Two files, one rule: **the machine's says how the reviewer runs, the
repository's says what is reviewed** — and the repository's may restate any
key to override the machine's for itself. `reviewer init` writes the
repository's into the checkout. Commit `.review/`: the rules are then
versioned with the code they govern, and CI reads them from the checkout like
any other file.

```text
.review/
├── config.yaml     excludes, which skill applies to which paths; the model only if pinned here
├── prompts/        every *.md here is added to every file's prompt
├── skills/         one Markdown file per convention
└── .gitignore      keeps a project-specific .env out of git
```

To use a local model instead of Anthropic:

```bash
LLM_PROVIDER=local LLM_BASE_URL=http://localhost:11434/v1 LLM_MODEL=qwen2.5-coder LLM_API_KEY=ollama \
  reviewer review --base main
```

## Usage

```bash
reviewer review --base main                        # text, for a human
reviewer review --base main --format ndjson        # one JSON record per line, for a program
reviewer review --base main --format github        # GitHub Actions annotations + job summary
reviewer review --base main --out findings.ndjson  # ...and a machine-readable copy, whatever --format prints
reviewer review --preview --base main              # scope only: no model, no cost
reviewer review --base main --fail-on bug,security # exit 3 when one of those is reported
reviewer review --uncommitted                      # the work that is not in a commit yet
```

### Commands

| Command            | What it does                                                                            |
| ------------------ | --------------------------------------------------------------------------------------- |
| `reviewer review`  | Review the checkout against a base.                                                     |
| `reviewer comment` | Post a findings file to a pull request. Needs `GITHUB_TOKEN`; runs no model.            |
| `reviewer init`    | Write the config file: `.review/` inside a checkout, `~/.config/reviewer/` outside one. |

### Review flags

| Flag                                                    | Effect                                                                                            |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `--base NAME`                                           | Base the checkout (`HEAD`) is compared against (default `main`).                                  |
| `--uncommitted`                                         | Review the working tree against `HEAD`: staged, unstaged and untracked work. Not with `--base`.   |
| `--since REF`                                           | Review only the commits after `REF` (the diff `REF..HEAD`). Not with `--base` or `--uncommitted`. |
| `--format text\|ndjson\|github`                         | How findings are reported (default `text`).                                                       |
| `--out PATH`                                            | Also write every record to this file as NDJSON. This is what a CI bot reads.                      |
| `--preview`                                             | Print which files would be reviewed and why the others are skipped, then stop.                    |
| `--fail-on LIST`                                        | Exit `3` when a reported finding has one of these severities, e.g. `bug,security`.                |
| `--lang LANG`                                           | Language of each finding's body (default `en`). JSON keys and severities stay English.            |
| `--exclude GLOB`                                        | Skip files matching the glob; repeatable.                                                         |
| `--skills-path PATH`                                    | Directory of review skills inside the reviewed repo; empty disables skills.                       |
| `--no-verify`                                           | Report every finding the model produced, skipping the verification pass.                          |
| `--config PATH`                                         | Another repository `config.yaml`, in place of the nearest `.review/config.yaml`.                  |
| `-v`, `-q`, `--log-level`, `--log-format`, `--no-color` | Logging; see [docs/output.md](docs/output.md#logging).                                            |

Exit codes: `0` success · `1` usage error · `2` a configuration or working-tree
problem the operator can fix · `3` a finding matched `--fail-on`.

### Output formats

| `--format` | Goes to              | For                                                                        |
| ---------- | -------------------- | -------------------------------------------------------------------------- |
| `text`     | stdout               | A human at a terminal.                                                     |
| `ndjson`   | stdout               | A program: one `finding` record per finding, then one `summary`.           |
| `github`   | stdout + job summary | A GitHub runner: annotations on the changed lines, a table in the summary. |

Logs always go to stderr, so stdout parses line by line. The NDJSON record
shapes and the summary counters are documented in
[docs/output.md](docs/output.md).

## Configuration

Precedence, highest first: **command line › environment › `.env` ›
`<repo>/.review/config.yaml` › `~/.config/reviewer/config.yaml` › built-in
default.**

The machine's file and a repository's, at their smallest useful:

```yaml
# ~/.config/reviewer/config.yaml
version: 1
settings:
  llm: { provider: claude, model: claude-sonnet-4-6, api-key: ${ANTHROPIC_API_KEY} }
  language: en
```

```yaml
# <repo>/.review/config.yaml
version: 1
settings: # on top of the machine's
  exclude: ["**/*.spec.ts", "**/migrations/*.ts"]
  max-findings-per-file: 3
skills: # this file only
  path: skills # beside config.yaml
  defaults: [{ globs: "**/*.ts", skills: [typescript-base] }] # the baseline
  mappings:
    api-conventions: ["src/api/**/*.ts"]
    error-handling: "src/**/*.ts"
```

`settings` is how the reviewer runs and may be set in either file: a key the
repository restates wins, and `llm` merges key by key, so
`settings: { llm: { model: claude-opus-4 } }` pins the model and keeps the
machine's provider. `skills` is what the code is held to and belongs to the
repository's file alone.

`${ANTHROPIC_API_KEY}` reads the environment, so the file is shareable and the
variable's name is yours; the key itself lives in `~/.config/reviewer/.env` or
the gitignored `.review/.env`. A key the schema does not recognise is rejected
by its place in the file.

Without any file, environment variables describe the whole run
(`LLM_PROVIDER`, `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL`, `REVIEW_*`) —
which is also how a CI runner, having no `~/.config/reviewer/`, is told the
model: by the action's inputs.

Every key, its default and the environment variable behind it:
[docs/configuration.md](docs/configuration.md). The complete annotated
reference is [templates/config.example.yaml](templates/config.example.yaml).

## Review skills

A skill is one Markdown file of review guidelines. Which files it applies to
is stated once, in `config.yaml`: `skills.defaults` for the baseline a whole
language or area shares, `skills.mappings` for the paths one skill alone
reviews. Skills live in the reviewed repository; the reviewer ships none of
its own.

```markdown
<!-- .review/skills/api-conventions.md -->

---

name: api-conventions
description: Rules for HTTP handlers.
---

- Every handler validates its input with a schema before reading it.
- `req.body` is never read directly; use the validated payload.
- Authorisation happens in middleware, not inside the handler.
```

```yaml
# .review/config.yaml
skills:
  path: skills
  defaults: # the skills every file these globs match is held to
    - globs: ["**/*.ts", "**/*.tsx"]
      skills: [typescript-base, naming]
  mappings: # skill -> the globs only it reviews, added to the baseline
    api-conventions: ["src/api/**/*.ts"]
    background-jobs: [] # switched off without deleting the file
```

For a changed file whose path matches, the skill's text is rendered into the
prompt under _"Project/framework standards for this file"_; the report names
the skills that were in the prompt. `src/api/users.ts` above is held to
`typescript-base`, `naming` and `api-conventions` at once. A file that matches
nothing is still reviewed with the four lenses alone.

Instructions that should hold on **every** file go in `.review/prompts/*.md`
instead. Both are described in
[docs/configuration.md](docs/configuration.md#standing-instructions).

## GitHub Action

Two composite actions, two jobs, no job holding both a model and a write
token:

```yaml
# .github/workflows/pr-review.yml
name: PR review
on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]
permissions: {}

jobs:
  review:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v5
        with:
          fetch-depth: 0 # the reviewer needs the merge-base
          ref: ${{ github.event.pull_request.head.sha }}
      - uses: husnuguner/code-reviewer/actions/review@v0.0.10
        with:
          provider: claude # the workflow names the model: a runner has no ~/.config/reviewer
          api-key: ${{ secrets.ANTHROPIC_API_KEY }}
          skills-path: .review/skills
          incremental: true # on a push, review only the commits it added
          out: code-review.ndjson
          annotations: false # the comment job posts them

  comment:
    needs: review
    if: ${{ always() && needs.review.result != 'cancelled' }}
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
    steps:
      - uses: actions/download-artifact@v7
        id: findings
        with: { name: code-review-findings }
        continue-on-error: true
      - uses: husnuguner/code-reviewer/actions/comment@v0.0.10
        if: ${{ steps.findings.outcome == 'success' }}
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
          findings: code-review.ndjson
          request-changes-on: bug,security # red badge + merge block where protection asks
          supersede: true # one current verdict per PR; a clean run lifts the block
```

The `review` job produces annotations (optional), a job summary and an NDJSON
artifact. The `comment` job turns anchored findings into inline review
comments, lists unanchored ones in the body, skips a line an earlier run
already commented on so a pull request does not collect the same comment once
per push, and may request changes. **It never approves.**

Inputs, the `reviewer comment` flags, and pinning advice:
[docs/github-action.md](docs/github-action.md).

## Security model

- **The process that reads untrusted diff text cannot write anywhere.** The
  review holds only the model's key; posting is a separate run with only a
  hosting token.
- **Everything the model is shown is data, never instructions.** The diff, the
  file, the pre-context and the skills cannot change the reviewer's scope or
  output shape; an attempt to do so is itself a `security` finding.
- **Credential files are never read or prompted.** `.env`, keys, certificates,
  `.ssh/`, `.aws/`, `.npmrc` and the like are skipped before anything is read.
  `exclude` can add to that list; nothing can take away from it.
- **The review policy is not configurable.** A project adds standing
  instructions and skills on top of it; it cannot drop a hard rule.
- **A pull request cannot loosen the rules it is reviewed under.** In CI the
  `.review/` that is read is the base branch's, not the pull request's; and a
  change that edits `.review/` is named in the summary and in the posted
  comment either way, so the reader knows to look at those files.
- **Secrets never reach a log line.** Values of `*_API_KEY`, `*_TOKEN`,
  `*_SECRET`, `*_PASSWORD` variables are masked at the sink in every format.
- **The bot may request changes; it may not approve.**

## Documentation

| Document                                           | Covers                                                                                |
| -------------------------------------------------- | ------------------------------------------------------------------------------------- |
| [docs/how-it-works.md](docs/how-it-works.md)       | Scope selection, pre-context, the prompt, anchoring, verification, volume, caching.   |
| [docs/configuration.md](docs/configuration.md)     | `.review/`, `config.yaml` keys, environment variables, standing instructions, skills. |
| [docs/output.md](docs/output.md)                   | Formats, the NDJSON contract, summary counters, exit codes, logging.                  |
| [docs/github-action.md](docs/github-action.md)     | The workflow, both actions' inputs, `reviewer comment`, pinning.                      |
| [docs/architecture.md](docs/architecture.md)       | Layout, design principles, decisions, tests, releasing.                               |
| [docs/troubleshooting.md](docs/troubleshooting.md) | Symptoms, causes and fixes.                                                           |

## Development

```bash
bun install
bun run check          # tsc --noEmit + eslint + prettier --check + bun test
bun test               # the tests alone
bun run reviewer …     # the CLI from source
```

Bun is the package manager, the test runner and the runtime; there is no build
step. Layout and conventions are in
[docs/architecture.md](docs/architecture.md).

## Contributing

Issues and pull requests are welcome. Before opening a PR:

1. `bun run check` passes.
2. Behaviour changes come with a test; pure modules are pinned by fixtures
   under `tests/fixtures/`.
3. A change to a flag, an action input or the NDJSON contract updates the
   matching page under `docs/`.

Bugs and feature requests:
[github.com/husnuguner/code-reviewer/issues](https://github.com/husnuguner/code-reviewer/issues).

## Versioning

Releases follow GitHub's action convention: an immutable `vX.Y.Z` tag per
release and a moving major tag (`v0`) pointing at the latest `v0.*`.

**While the major is 0, any release may change the action's inputs or the
NDJSON contract.** Pin the exact version in workflows; `@v0` is the
convenience. `1.0.0` is the release that turns both into promises.

## License

[MIT](LICENSE) © Hüsnü Güner
