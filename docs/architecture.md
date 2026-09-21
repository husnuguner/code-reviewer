# Architecture

For contributors and embedders. The user-facing behaviour is described in
[How it works](how-it-works.md).

## Layout

Three layers, one direction. The core does the work and asks for abstract
objects; the providers layer supplies them; the CLI chooses which. ESLint
enforces the arrows (`import-x/no-restricted-paths`): `core/` imports neither
`providers/` nor `cli/`, and `providers/` never imports `cli/`.

```text
src/
├── core/        the work; depends on nothing of ours
│   ├── ports/       what it asks for from outside (interfaces)
│   ├── domain/      Finding, Skill, changed-file records
│   ├── review/      selection · review-file · branch-review · anchor · verify · volume · render
│   ├── diff/        unified-diff parsing, patch views
│   ├── skills/      glob engine, frontmatter parser, registry
│   ├── posting/     records → one review payload (pure)
│   ├── config/      the convict schema of config.yaml · policy checks on a file · ${VAR} · init · the Config facade
│   └── util/        errors, text, JSON, timing, completion-ordered promises
├── providers/   what can change; every implementation of a port
│   ├── llm/         model-provider (kind) · claude/ · local/ · AI SDK adapter · retry decorator
│   ├── repository/  repository-provider (kind) · github/
│   ├── reporting/   format-provider (kind) · text/ · ndjson/ · github/ · tee, collecting, closable
│   ├── git/         Bun.spawn: diff source and pre-context
│   ├── skills/      directory and worktree sources
│   ├── config/      where the two config.yaml files live, how they are read; .env layers; one run's Config via convict
│   ├── logging/     pino → stderr
│   ├── console/, assets/, http/
│   ├── provider.ts  Provider<In, Out>
│   └── registry.ts  ProviderRegistry
├── cli/         the composition
│   ├── main.ts        the executable
│   ├── reviewer.ts    the root command: a registry of subcommands
│   ├── command-line.ts how a command is defined; how its errors become exit codes
│   ├── container.ts   the composition root (awilix)
│   ├── options/       flag groups more than one command takes
│   └── commands/<name>/{command,run}.ts   one folder per command
└── lib/         standalone code that imports nothing of ours (resilience/, github-actions/)
```

### `src/core/` — the work

`ports/` is the whole of what the core asks for: `ChatModel`, `ReviewPoster`,
`BranchReviewReporter`, `GitReader`, `CodeContext`, `SkillSource`,
`ConfigDirectory`, `Logger`, `ConsoleOutput`. Nothing in this tree knows which
vendor, host or rendering answers.

Key modules under `review/`:

| Module             | Role                                                                          |
| ------------------ | ----------------------------------------------------------------------------- |
| `selection.ts`     | Which files are in scope, and why the rest are not. Pure.                     |
| `review-file.ts`   | The per-file step: skills, content, pre-context, model, anchor, verify.       |
| `file-reviewer.ts` | The only place the model is asked for findings; parses and anchors the reply. |
| `verify.ts`        | The verification pass; fails open.                                            |
| `anchor.ts`        | Two signals (line, quote) settled into one anchor.                            |
| `branch-review.ts` | The flow: git → select → review in parallel → cap → stream records.           |
| `volume.ts`        | `max-findings-per-file`.                                                      |
| `render.ts`        | Text report and preview.                                                      |
| `guards.ts`        | Credential paths and binary patches: never the project's to override.         |

### `src/providers/` — what can change

Where a port has several implementations selectable by name, the folder has
one shape: a _kind_ (an abstract `Provider` subclass that owns what that kind
needs — a default model, a token variable), one folder per implementation,
and `builtin.ts` listing the instances. Three things vary this way:

| Varies by      | Kind                             | Implementations            |
| -------------- | -------------------------------- | -------------------------- |
| `LLM_PROVIDER` | `llm/model-provider`             | `claude`, `local`          |
| `--format`     | `reporting/format-provider`      | `text`, `ndjson`, `github` |
| `--provider`   | `repository/repository-provider` | `github`                   |

Adding one is a file and a line: configuration, `--help`, the refusal a typo
meets and the composition root all learn the name from the registry.

### `src/cli/` — the composition

Each command is two files: `command.ts` says what it takes, `run.ts` what it
does. `review` calls a model and cannot post; `comment` holds a
token and cannot call a model; `init` writes a config file.
Each has its own composition root, so no run ever holds both credentials.

## Embedding

`core/` is published as `code-reviewer/core` and `providers/` as
`code-reviewer/providers`. The core takes its adapters as constructor
arguments, so an embedder adds a vendor, a host or a rendering by extending a
kind and handing an instance to the registry, never by editing the core.

## Design principles

- **One function decides scope.** `selectFiles` is pure and both the run and
  `--preview` consume its output, so the free pre-flight cannot promise work
  the paid run would skip. The model's change set is built from it too, so an
  excluded or credential file cannot reach a prompt as a "related change".
- **`Config` is the single source of truth.** Every field is derived from the
  `CONFIG_ALIASES` table (field → env alias) and the zod schema. The flow never
  reads the flat config; `fileReviewSettings()`, `reportPolicy()` and
  `concurrency()` hand it typed setting groups.
- **Nothing is dropped in silence.** Refuted, capped, mislabelled, unanchored,
  failed, truncated, skipped: each is counted or listed.
- **What the model may comment on is what the model was shown.** The annotated
  diff, the allowed lines and the anchor haystack are one value (`patchView`),
  cut together at a hunk boundary.
- **Reporting is the end of the line.** The reviewer writes to a stream; what
  becomes a comment is decided downstream, by something that cannot call a
  model.
- **One way to say each thing.** `errorMessage()` renders any thrown value;
  `show()` spells every value a message names.

## Decisions

The choices with a real trade-off behind them, and what was given up:

- **The reviewer reads local git and posts nothing.** A job that feeds
  untrusted diff text to a model must not hold a write credential. Given up:
  reading a PR's existing comments to avoid repeating them.
- **Skills belong to the reviewed repository, not to the reviewer.** They are
  that repository's conventions, versioned with its code. The reviewer ships
  none.
- **The machine's config file says how; the repository's says what.** The
  model, its key's name and the caps are set once per machine; skills,
  mappings and excludes are set once per repository, which may also restate
  any machine key for itself. There is no list of projects anywhere: a project
  is a checkout that carries `.review/`. Given up: reviewing a repository with
  personal skills without putting a `.review/` in it, and reviewing a checkout
  from outside it.
- **A skill's scope is stated once, in the repository's config file.** A skill
  document carries no scope of its own. Two places for one decision means one
  of them eventually lies.
- **Every relative path in a config file is taken from the file's own
  directory.** One base for all of them.
- **The whole system prompt is the reviewer's own.** No setting can drop a
  hard rule or break the parser. A project extends the review with standing
  instructions and skills, which arrive as data.
- **Everything the model is shown is data, never instructions.** An attempt to
  steer the reviewer from inside a diff is itself a `security` finding.
- **Pre-context is deterministic.** The reviewer decides what surrounding code
  to fetch; the model asks for nothing. The review stays one call.
- **The bot may request changes; it may not approve.** Given up: a fully
  automated green tick.

## Tests

- `tests/contracts/` pin every pure module to the fixtures in
  `tests/fixtures/`.
- `tests/core/`, `tests/providers/`, `tests/cli/` cover the flow and the
  adapters against **real git** (a throwaway repository per test) and a mock
  language model. Git is not mocked: letting git compute the diff is the point.
- `tests/actions/` and `tests/cli/commands/comment/action.test.ts` keep the
  composite actions in step with the commands they wrap.
- `tests/core/config/config-example.test.ts` keeps
  `templates/config.example.yaml` in step with the parser.

## Development

```bash
bun install
bun run check          # tsc --noEmit + eslint + prettier --check + bun test
bun test               # the tests alone
bun run reviewer …     # the CLI from source, as `reviewer` would run
bun link               # a `reviewer` executable on PATH from this checkout
```

Toolchain: Bun (pinned in `.bun-version`; package manager, test runner and
runtime, no build step) · TypeScript 6 · ESLint 10 with type-aware rules ·
Prettier.

Bun reads a working directory's `.env` by default. This repository turns that
off (`bunfig.toml`, `env = false`) and the executable carries `--no-env-file`
in its shebang: the reviewer reads `.env` files itself in a stated order in
which the working directory's is the weakest, and the working directory is
the checkout under review.

## Releasing

With `X.Y.Z` the version being released:

```bash
bun pm version X.Y.Z --no-git-tag-version  # package.json
git commit -am "release: vX.Y.Z"
git tag -a vX.Y.Z -m "vX.Y.Z"
git tag -f vX vX.Y.Z                        # move the major tag
git push origin main vX.Y.Z && git push -f origin vX
```

Update the `@vX.Y.Z` references in the README and `docs/github-action.md` in
the same commit. A tag is not a GitHub Release; publish one separately
(`gh release create vX.Y.Z --verify-tag --notes-file …`).
