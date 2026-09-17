# Runbook — running the reviewer on your own repositories

The short version of "how do I run this right now". The full reference is in
[README.md](README.md). Nothing here depends on any other project: the reviewer
is this repository, Node 24 and the two files described under **Your setup**.

## 0. One-time install

From GitHub, once it is pushed (a `prepare` step builds on install):

```bash
npm install -g github:husnuguner/code-reviewer      # -> reviewer, review-comment
```

Or from this checkout, while working on the reviewer itself:

```bash
cd ~/Documents/workspace/code-reviewer
npm install          # Volta picks Node 24.21 / npm 11.19 from package.json automatically
npm run build        # -> dist/cli/index.js, dist/cli/comment.js
```

Two ways to invoke it; pick one and stick with it:

| Command                      | Runs                          | When                                    |
| ---------------------------- | ----------------------------- | --------------------------------------- |
| `npm run reviewer -- <args>` | the built `dist/`             | day to day (rebuild after code changes) |
| `npm run dev -- <args>`      | `src/` directly through `tsx` | while changing the reviewer itself      |

`--` separates npm's own flags from the reviewer's. Optional: `npm link` puts a
global `reviewer` command on your PATH so `reviewer <args>` works from anywhere.

## 1. Your setup (already in place)

Everything lives under `~/.config/reviewer/`. Nothing is committed anywhere.

```text
~/.config/reviewer/
├── config.yaml            the model, review policy, projects
├── .env                   the one secret the catalogue names (chmod 600)
├── prompts/system.md      the review policy you own
└── skills/shop/    that project's skills (if not kept in its .review/)
```

### `config.yaml`

```yaml
version: 3
defaults:
  llm:
    provider: claude
    model: claude-opus-5
    api-key: ANTHROPIC_API_KEY                                     # the variable in .env
  language: tr
  prompts: [prompts/system.md]
  skills: { path: ~/.config/reviewer/skills/{{project}} }
  exclude: ["**/*.md", "**/*.tsx", "**/__tests__/**", "..."]
projects:
  shop:
    local-path: ~/work/shop       # the checkout this project reviews
    skills:
      mappings: { api-rules: ["src/api/**/route.ts"], "...": ["one entry per skill"] }
```

`defaults` is what every project starts from; a project overrides a key by
restating it (`llm` merges key by key). Not shown: `max-context-chars` (default 6000) caps what the reviewer fetches around each file before asking the model
— imported modules' signatures, users of changed exports, related diffs; `0`
switches it off. `skills.mappings` is a project's own;
`skills.path` and `prompts` are shared, and `{{project}}` in them is the
project's name. `max-findings-per-file` is left out on purpose: the built-in
default is 3 findings per file. Every key, with its meaning and default,
is in [`docs/config.example.yaml`](docs/config.example.yaml).

To switch to a local model, edit `defaults.llm` (the commented block in your
file): `provider: local`, `base-url: http://127.0.0.1:1234/v1`, `api-key`
anything the server accepts. Nothing else changes.

### `.env` — the secrets

```dotenv
ANTHROPIC_API_KEY=...          # named by defaults.llm.api-key
```

That is the whole list. The reviewer reads local git and reports; it holds no
repository token, because it has nothing to post (see
the README's "Why the reviewer cannot post").

A secret setting takes either a variable's **name** (spelled like one) or the
value itself; naming keeps `config.yaml` shareable. Exported `LLM_*` /
`REVIEW_*` variables override the catalogue for every project — leave them
unset unless you mean that.

### `prompts/system.md` — the review policy

The half of the system prompt you own: who the reviewer is, the four lenses,
what is out of scope. Edit it, or add a file and list it in `prompts`
(`[prompts/system.md, prompts/mine.md]` — concatenated in order). The JSON
output contract is appended by the reviewer and cannot be changed, so nothing
you write here can break parsing. The shipped text is `prompts/system.md` in
this repository; `reviewer init` copies it once and never overwrites it.

## 2. Skills — the review rules

A skill is a Markdown file with a frontmatter (`name`, optional `description`)
and a body of rules. **Two halves, two places, both under `~/.config/reviewer`:**

| Half                           | Where                                                 |
| ------------------------------ | ----------------------------------------------------- |
| the rules (the `.md` files)    | `~/.config/reviewer/skills/` (`defaults.skills.path`) |
| which files each skill reviews | `projects.shop.skills.mappings` in `config.yaml`      |

The skills live **in the reviewed repository**, under `.review/skills/`, and
nowhere else: that is the copy the team edits, reviews and commits, and the
copy CI reads. Keep no second copy on your machine -- two copies drift, and the
one CI does not read is the one that gets edited.

A new project is one command, run from inside its checkout:

```bash
cd ~/work/new-repo
reviewer add new-repo                # skills at ./.review/skills, versioned with the code (recommended)
reviewer add new-repo --skills ~/.config/reviewer/skills/new-repo   # or: on this machine only
```

It adds the entry to `config.yaml` without touching your comments, and prints
the next steps. Then drop the skills in and add `skills.mappings` to the
project.

- To change what a skill covers, edit the project's `skills.mappings` — not
  the file. `[]` switches a skill off.
- A mapping for a skill that is not in the directory logs
  `Skill mapping for '…' matches no loaded skill`.

The log line `Loaded N skill(s): ...` confirms what was picked up; `skills=[...]`
per file shows which ones matched.

## 3. Run it

All commands from `~/Documents/workspace/code-reviewer`. Add `--verbose` for
DEBUG logs (stderr); stdout stays clean.

### Look before you spend anything

```bash
npm run reviewer -- --project shop --preview --base develop
```

`--preview` calls no model: it prints the file selection (and why each other
file was skipped) and stops. Use it to check scope — exclude globs, a big
diff, a lockfile you forgot. It needs no credentials at all.

### Review a branch

```bash
npm run reviewer -- --project shop --base develop                      # HEAD vs develop, text
npm run reviewer -- --project shop --branch feature/checkout-v2 --base develop
npm run reviewer -- --project shop --base develop --format ndjson > out.ndjson
```

Reads `local-path` (or the current directory when unset), diffs
`base...branch` (merge-base), prints findings as text or NDJSON. Needs only
the LLM settings.

Nothing is posted anywhere. To get findings onto a pull request, run the
reviewer in CI and let a bot do the talking — see §3.1.

### 3.1 In CI, with a bot posting the comments

The shipped action reviews the checkout and produces annotations, a job
summary and `code-review.ndjson`; a second job with `pull-requests: write`
runs `review-comment` (this repository's own poster, in `comment-action/`)
which reads that file and posts one review. Copy
[`.github/workflows/pr-review.yml`](.github/workflows/pr-review.yml) into the
reviewed repository and change `uses: ./` to `uses: husnuguner/code-reviewer@v1`.

The only secret the review job needs is `ANTHROPIC_API_KEY`. Its permissions
are `contents: read` — it cannot write to the pull request, which is the
point: the process that reads an untrusted diff into a model has no way to
talk back.

Commit the skills into the reviewed repository (e.g. `.review/skills/`) and
point `skills-path` at them, because a CI runner has no
`~/.config/reviewer/skills`.

Test the wiring without paying for a model: set `preview: true` on the action.

You can also rehearse the posting half locally, against a findings file and
without a token:

```bash
npm run review-comment -- --findings out.ndjson --repo owner/name --pr 7 --dry-run
```

### Gate a build on findings

```bash
npm run reviewer -- --project shop --base develop --fail-on bug,security
```

Exit `3` when a reported finding has one of those severities. Reporting is
unaffected — this only decides the exit code. The default is `none`.

### Useful extras

```bash
npm run reviewer -- --exclude "**/generated/**" --base develop     # add globs for this run only
npm run reviewer -- --project shop --base develop           # explicit when >1 project
npm run reviewer -- --config /path/other-config.yaml projects      # a different catalogue
npm run reviewer -- --help
```

## 4. Reading the output

- Text: per file, `path:line  **[Severity]** body`, then the summary.
- NDJSON: one `{"type":"finding", ...}` per finding, one `{"type":"summary"}` at the end.
- The summary record says where every finding ended up: `findings`, `unanchored`, `refuted` (dropped by verification), `capped` (withheld by `max-findings-per-file`), and the `anchors` tally.
- It also reports scope: `skipped` counts each reason (`excluded`, `secret`, `status`, …) — what the review was never shown. `--preview` names those files one by one.

## 5. When it does not run

| Symptom                                                  | Cause / fix                                                            |
| -------------------------------------------------------- | ---------------------------------------------------------------------- |
| exit 2, `ANTHROPIC_API_KEY ... is not set`               | Put it in `~/.config/reviewer/.env`, or export it                      |
| exit 2, `1 validation error for Config`                  | A setting has the wrong shape; the message names the variable          |
| exit 2, `... is not a git repository`                    | Run inside a checkout, or set `local-path` / `REVIEW_LOCAL_PATH`       |
| exit 2, `'repositories' was removed in schema version 3` | A v2 catalogue: drop `repositories` and `repository`, add `local-path` |
| exit 3                                                   | Not an error: a finding matched `--fail-on`                            |
| `No merge-base for 'X' and 'Y'`                          | Unrelated refs, or a shallow clone — CI needs `fetch-depth: 0`         |
| 0 findings and `files_reviewed=0`                        | Everything was skipped; `--preview` says why, per file                 |
| `Skill mapping for '…' matches no loaded skill`          | The mapping names a skill that is not in `skills.path` — see §2        |
| exit 1 with a usage message                              | Bad flag; `--help`                                                     |

Exit codes: `0` done · `1` usage error · `2` configuration or working-tree
error · `3` findings matched `--fail-on`.

## 6. Sanity check (no model call)

```bash
npm run reviewer -- projects                                        # the catalogue is read
npm run reviewer -- --project shop --preview --base develop --verbose
```

The second one resolves the config, opens local git, computes the merge-base
and prints the scope — without calling a model or reading any key.
