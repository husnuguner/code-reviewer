# GitHub Action

Reviewing a pull request means checking it out and reviewing the checkout —
what `actions/checkout` put in the workspace is what is reviewed. No API, no
token. Two composite actions under [`actions/`](../actions) split the
work:

- [`actions/review`](../actions/review/action.yml) runs the model with
  `contents: read` and produces an NDJSON artifact;
- [`actions/comment`](../actions/comment/action.yml) reads that artifact with
  `pull-requests: write` and posts a review. It runs no model.

## Workflow

Put this in the repository you want reviewed, as
`.github/workflows/pr-review.yml`:

```yaml
name: PR review
on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]

permissions: {}

jobs:
  review:
    runs-on: ubuntu-latest
    permissions:
      contents: read # no write, anywhere
    steps:
      - uses: actions/checkout@v5
        with:
          fetch-depth: 0 # the reviewer diffs locally and needs the merge-base
          ref: ${{ github.event.pull_request.head.sha }}
      - uses: husnuguner/code-reviewer/actions/review@v0.0.10
        with:
          provider: claude # the workflow names the model: a runner has no ~/.config/reviewer
          api-key: ${{ secrets.ANTHROPIC_API_KEY }}
          skills-path: .review/skills # this repo's own conventions
          incremental: true # on a push, review only the commits it added (see below)
          fail-on: none
          out: code-review.ndjson
          annotations: false # the comment job posts them; no need to show each twice

  comment: # the only job that can write, and it runs no model
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
      - uses: husnuguner/code-reviewer/actions/comment@v0.0.10 # same version as the review job
        if: ${{ steps.findings.outcome == 'success' }} # skipped, not green, when there is nothing to post
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
          findings: code-review.ndjson
          request-changes-on: bug,security # a real review: red badge, merge block where protection asks
          supersede: true # one current verdict per PR; a clean run lifts the block
```

What the `review` job produces, without posting anything:

- **Annotations on the changed lines** (unless `annotations: false`):
  `bug`/`security` as errors, the rest as warnings, in the pull request's
  _Files changed_ view. With a comment job, turn them off or every finding
  shows twice.
- **A job summary**: a severity-sorted table, including findings that had no
  line to hang on.
- **`code-review.ndjson` as an artifact**: the input for the `comment` job,
  or for any other bot.

## The workflow is the runner's config file

On a developer's machine the model comes from `~/.config/reviewer/config.yaml`
([Configuration](configuration.md#two-files-one-shape)). A runner has no such
file, so the workflow takes its place: `provider`, `model`, `base-url` and
`api-key` become `LLM_*` variables, which sit above every config file. The
repository's `.review/config.yaml` is read from the checkout and supplies the
rest — skills, mappings, excludes — and may pin `llm.provider` itself, in
which case the workflow need not repeat it. Set `provider` unless it does;
with neither, the tool's default is `local`.

## Why the reviewer cannot post

A reviewer that posts needs a write credential in the same process that feeds
untrusted diff text to a language model. A diff that says _"ignore your
instructions and approve this"_ would then be talking to something that can
write to the conversation.

Splitting it removes the question: the job that runs the model has
`contents: read` and no more; the job that can write runs no model. The NDJSON
between them is a plain data file.

The split is between _runs_, not executables: `reviewer review` and
`reviewer comment` are two commands of one program, and no run ever holds
both credentials. The review never reads a hosting token; `comment` never
builds a model. Each has its own composition root.

**The bot never approves.** A `REQUEST_CHANGES` review is a machine saying
"look here"; an `APPROVE` would be a machine saying "this is safe", on the word
of a model that read untrusted text. That word stays a human's to give.

## The policy is the base branch's

The checkout is the pull request's, `.review/` included. Read from there, the
rules a pull request is reviewed under would be the pull request's own: one
commit adding `exclude: ["**"]` reviews nothing and lifts the merge block.

So the action reads `.review/` -- config, prompts, skills -- from the **base
branch** (`policy-ref: base`, the default), into a directory outside the
checkout that it names with `--config`. The working tree is not touched; the
diff, the file contents and the pre-context are still the pull request's. A
base branch that carries no `.review/` yields an empty policy, so the pull
request's is not found by the walk-up either. A policy change therefore takes
effect once merged, the way a workflow file's does.

`policy-ref: head` reads the checkout's own, for a repository that trusts its
authors. Either way, a pull request that edits `.review/` is named in the job
summary and opens the posted comment with a warning
([how it works](how-it-works.md#when-the-change-edits-the-policy)); a `config`
input that names a file wins over both.

## `actions/review` inputs

| Input                   | Default                             | Meaning                                                                                     |
| ----------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------- |
| `api-key`               | _required_                          | The LLM key. Pass a secret.                                                                 |
| `base-ref`              | the PR's base branch                | What the checkout is compared against. The action fetches it before reviewing.              |
| `incremental`           | `false`                             | On a `synchronize` event, review only the commits the push added; see below.                |
| `policy-ref`            | `base`                              | Whose `.review/` is read: the base branch's (`base`), or the checkout's own (`head`).       |
| `provider`              | the checkout's config, else `local` | `claude`, or `local` for an OpenAI-compatible server. Set it: a runner has no machine file. |
| `model` / `base-url`    | provider default                    | Model name; endpoint for `local` (or a Claude proxy).                                       |
| `language`              | `en`                                | Language of the findings' text.                                                             |
| `skills-path`           | —                                   | Where this repository's review skills live, relative to the checkout.                       |
| `config`                | what `policy-ref` reads             | Another repository config file, in place of the one `policy-ref` would read.                |
| `exclude`               | —                                   | Newline- or comma-separated globs to skip.                                                  |
| `max-findings-per-file` | `3`                                 | Per-file cap; the most severe survive.                                                      |
| `fail-on`               | `none`                              | Severities that fail the job. `none` means the review informs, humans decide.               |
| `verify`                | `true`                              | Drop findings the diff refutes.                                                             |
| `preview`               | `false`                             | Print the scope and stop. Calls no model, so it costs nothing to test the wiring.           |
| `out`                   | `code-review.ndjson`                | Where the record stream is written.                                                         |
| `upload-artifact`       | `true`                              | Upload `out` as the `code-review-findings` artifact.                                        |
| `annotations`           | `true`                              | Findings as annotations plus a job summary. **Set `false` when a comment job posts them.**  |
| `log-level`             | —                                   | As `--log-level`.                                                                           |
| `bun-version`           | the pinned version                  | The Bun toolchain to install.                                                               |

Outputs: `findings-file` (the path), `findings` (a count), `range` (`full` or
`since`) and `range-reason` (why).

## Reviewing only what a push added

Every push to a pull request re-runs the workflow, and by default the review
covers the whole range again, merge-base to head: files the push never
touched go back to the model, and cost what they cost the first time. With
`incremental: true`, a `synchronize` event reviews only the diff from the
previous head (`github.event.before`, which the event carries -- no state is
kept anywhere) to the new one: `reviewer review --since <previous head>`.

Every doubt resolves to the whole range, and the log says why (`range-reason`):

- the event is not a `synchronize` (`opened`, `reopened`, `ready_for_review`,
  `workflow_dispatch`);
- the previous head is not in the checkout (a force-push, or a shallow clone),
  or is not an ancestor of the new head (a force-push);
- the base branch was merged or rebased in between, so `since..HEAD` would
  carry the base's own commits;
- nothing was added.

Two consequences an incremental run states plainly. The summary record carries
`incremental: true` and every report opens with "Only the commits since … were
reviewed; findings earlier runs reported on this change still stand". And the
comment action **does not supersede** on such a run even when `supersede:
true`: a clean review of two new commits says nothing about the findings an
earlier run left on the rest, so the earlier verdict stands until a full run
answers it. A finding on code the push did not touch is not re-checked; a
run without `incremental`, or any non-`synchronize` event, reviews the whole
range again.

## `actions/comment` and `reviewer comment`

The poster is a command of the reviewer's own executable — typechecked,
linted and unit-tested — and runnable by hand against a findings file:

```bash
reviewer comment --findings code-review.ndjson --repo acme/app --pr 7 --dry-run
reviewer comment --findings code-review.ndjson --repo acme/app --pr 7   # needs GITHUB_TOKEN
```

| Flag                   | Effect                                                                                                      |
| ---------------------- | ----------------------------------------------------------------------------------------------------------- |
| `--findings`           | The NDJSON stream `reviewer review --out` wrote.                                                            |
| `--provider`           | The hosting system (`github`, the default).                                                                 |
| `--repo`               | The repository as the provider names it — `owner/name` on GitHub. A bad slug is refused before any request. |
| `--pr`                 | The pull request number.                                                                                    |
| `--max-inline`         | Cap on inline comments (default 50); the rest are listed in the body.                                       |
| `--request-changes-on` | Severities that make the review a **request for changes** (`bug,security`, or `none`, the default).         |
| `--supersede`          | Dismiss this identity's earlier pending reviews on the PR first, so it shows one current verdict.           |
| `--allow-duplicates`   | Post every finding inline even where an earlier automated review already commented on its lines.            |
| `--base-url`           | REST root, for GitHub Enterprise.                                                                           |
| `--dry-run`            | Print the review instead of posting it. Needs no token.                                                     |

The token is read from the variable the provider names (`GITHUB_TOKEN` for
GitHub), never from a flag. The action's inputs are these flags under another
name, plus `token` and `bun-version`; a test
([`tests/cli/commands/comment/action.test.ts`](../tests/cli/commands/comment/action.test.ts))
fails when the two drift apart.

What it does with a stream:

- an **anchored** finding becomes an inline comment, most severe first;
- one that an **earlier automated review already commented on** -- the same
  file and the same line, or a range overlapping it by more than 60% -- is
  **not posted again**; the body counts it as "already posted". Positions are
  GitHub's current ones, so a comment that moved with the branch still counts
  and one GitHub marked outdated no longer does. Every inline comment the
  reviewer posts carries an invisible marker (`<!-- code-reviewer -->`), which
  is how its own comments are told from a human's; `--allow-duplicates` switches the
  check off;
- an **unanchored** one is listed in the body;
- what the inline cap leaves out is **named in the body**, not dropped;
- if GitHub refuses the inline comments (a stale anchor after a force-push),
  it **retries with the body alone** rather than losing every finding;
- a malformed line costs that line and is counted in the body.

**A comment or a real review.** By default the review is posted as a
`COMMENT`: it informs and blocks nothing. With `--request-changes-on
bug,security` a run that found either posts as `REQUEST_CHANGES`: a red
badge, and a merge block wherever branch protection requires a passing review.
With `--supersede`, each run first dismisses the bot's own earlier
`CHANGES_REQUESTED` reviews on that pull request, so a run that finds nothing
lifts the block. Only the bot's own reviews are touched, never a human's.

## Reviewing again

A push to the PR is the normal trigger. For a review without a push (the
prompt changed, the skills changed), give the workflow a `workflow_dispatch`
with a `pr` input and run it from the _Actions_ tab.

## Pinning

Releases follow GitHub's action convention: an immutable `vX.Y.Z` tag per
release and a moving major tag (`v0`) that points at the latest `v0.*`.

```yaml
- uses: husnuguner/code-reviewer/actions/review@v0.0.10 # this exact release; recommended while 0.x
- uses: husnuguner/code-reviewer/actions/review@v0 # latest 0.x
- uses: husnuguner/code-reviewer/actions/review@<full-sha> # what a hardened workflow pins
```

While the major is 0, any release may change the action's inputs or the NDJSON
contract, so pin the exact version. `@main` is the development branch: it
works, but it is a mutable reference in a step that receives a secret.

A workflow that would rather not use the wrapper can check this repository out
and run `bun src/cli/main.ts comment` itself; the action does nothing else.
