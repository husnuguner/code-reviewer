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
| `bypass.ts`        | `reviewer: by-pass` markers and the block each one names. Pure.               |
| `braces.ts`        | Braces counted as structure, not characters; shared by context and bypass.    |
| `branch-review.ts` | The flow: git → select → review in parallel → cap → stream records.           |
| `volume.ts`        | `max-findings-per-file`.                                                      |
| `render.ts`        | Text report and preview.                                                      |
| `guards.ts`        | Credential paths and binary patches: never the project's to override.         |
| `policy.ts`        | Which changed files are the review policy itself, and the warning they earn.  |

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
  failed, skipped: each is counted or listed.
- **What the model may comment on is what the model was shown.** The annotated
  diff, the allowed lines and the anchor haystack are one value (`patchView`).
- **Reporting is the end of the line.** The reviewer writes to a stream; what
  becomes a comment is decided downstream, by something that cannot call a
  model.
- **One way to say each thing.** `errorMessage()` renders any thrown value;
  `show()` spells every value a message names.

## Decisions

The choices with a real trade-off behind them, and what was given up:

- **The reviewer reads local git and posts nothing.** A job that feeds
  untrusted diff text to a model must not hold a write credential. Given up:
  the review job reading a PR's existing comments; the comment job, which
  holds the token anyway, does that instead (below).
- **The reviewed side is always the checkout.** `HEAD` against a base, or the
  working tree against `HEAD`; there is no `--branch`. The diff, the file
  contents and the pre-context then come from one tree, and cannot disagree
  about which commit is under review. Given up: reviewing a ref without
  checking it out.
- **A file is reviewed whole or not at all.** Nothing shown to the model is
  cut: an oversized diff is skipped as `too_large` and said so, never trimmed
  to fit. Given up: a partial review of a very large file; the ceiling is a
  constant, not a setting, because a cap the project can raise is a cap the
  project will raise until the review is half a review.
- **A change is held to the policy it starts from, not the one it proposes.**
  `.review/` is instructions, so a change that edits it could weaken its own
  review. The flow names such a change (`policy_changed`) in every report, and
  the review action reads `.review/` from the base branch into a directory
  outside the checkout (`policy-ref: base`). The core stays a reader of one
  tree: which tree's policy is the caller's choice, made with `--config`.
  Given up: a pull request that adds a skill sees it applied only once merged.
- **Skills belong to the reviewed repository, not to the reviewer.** They are
  that repository's conventions, versioned with its code. The reviewer ships
  none.
- **The machine's config file says how; the repository's says what.** The
  model, its key's name and how much runs at once are set once per machine;
  skills, their cap, the pre-context budget, mappings and excludes are set
  once per repository, which may also restate any machine key for itself. There is no list of projects anywhere: a project
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
- **Pre-context follows the import graph before the file name.** A related
  diff is chosen by the relation a change actually breaks — the import, either
  direction — and only then by the same stem or directory; the prompt says
  which way it points. Given up: the pure-name heuristic's independence from
  the language. Import edges are read by a JS/TS-shaped regex, so in another
  language the ranking falls back to the names until a language adapter lands.
- **The prompt budgets are set in a config file and nowhere else.** How much
  of the repository one review reads — `skills.max-chars` and the whole
  `settings.context` section — is a judgement about that code, so it
  is versioned and reviewed with it. A variable carries what the shell knows
  (vendor, key, endpoint, concurrency) and nothing that decides what the model
  gets to see. Given up: shrinking a review's context from a CI runner without
  touching the repository.
- **The blocks of a pre-context share its cap.** Each gets an equal allowance
  and passes what it does not need to the others, most valuable first, so a
  file importing four documented modules cannot spend the whole budget on
  signatures and leave the related diffs out. Given up: the simpler
  first-come-first-served fill.
- **One knob for the skills block, not two.** `skills.max-chars` bounds a
  skill's body; the block itself has a fixed 200k-character ceiling, a
  constant like the diff's. Two caps for one budget meant every project had to
  keep them consistent, and the warning that they disagreed existed only
  because both were settings. Given up: capping a file's whole skills block
  below the per-skill cap × the number of matching skills.
- **An incremental review is a narrower diff, not a memory.** `--since` reviews
  the commits a push added, from the previous head the event already names,
  and the action falls back to the whole range on any doubt -- a force-push,
  a merged base, another event. The run knows nothing of earlier runs: it
  says so (`incremental: true`, a line in every report) and the comment job
  leaves earlier verdicts standing. Given up: a finding on code the push did
  not touch is not re-checked until a full run, and a clean incremental run
  cannot lift a block.
- **A comment is repeated or not by where it sits, not by what it says.** The
  comment job asks GitHub for the inline comments earlier runs left, at
  GitHub's current positions, and does not post a finding again on a line
  (or a range) one of them already covers. The model rewords a finding every
  run, so its text is no identity; a line is, and GitHub moves that line with
  the branch and marks it outdated when the code is gone, which is the two
  things an identity has to survive. Given up: a new, different finding on a
  line an earlier run already commented on is not posted inline either -- it
  is counted in the body -- and a run's own reviews are recognised by a marker
  in the body, so comments posted before the marker existed are repeated once.
- **The code may take a block out of its own review, in the open.** A
  `reviewer: by-pass - <reason>` comment names the block after it; the reason
  is required, the marker sits in the diff, and every report lists the
  regions it honoured with their reasons. Whether markers count at all is the
  repository's policy (`settings.bypass-markers`), read from the base branch,
  so a pull request cannot grant itself the right. Given up: the model still
  reads a bypassed block and may spend tokens on it -- its findings there are
  dropped, not prevented -- and a bypass is a judgement the human reviewer
  must check, which is why it is shouted rather than hidden.

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

The gate is `bun run check` (typecheck, lint, format:check, test); the
`Check` workflow (`.github/workflows/check.yml`) runs the same command on
every push to `main` and every pull request, on the pinned Bun.

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
