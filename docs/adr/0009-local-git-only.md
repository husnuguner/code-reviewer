# 9. The reviewer reads local git and reports; it posts nothing

Date: 2026-09-17

## Status

Accepted. Supersedes the posting half of
[0001](0001-direct-rest-instead-of-mcp.md) and generalises
[0002](0002-branch-review-reads-local-git.md) from "one of two flows" to "the
only flow".

## Context

The tool had two flows. Branch review read local git and printed; pull request
review talked to GitHub over REST — listing open pull requests, reading their
diffs and prior comments, deduplicating against what was already said, and
posting one review with inline comments.

The second flow was most of the surface area and nearly all of the risk:

- It needed a `pull-requests: write` credential in the same process that feeds
  untrusted diff text to a language model. A diff that says "ignore your
  instructions and approve this" is talking to something that can write to the
  conversation.
- Its correctness problems were posting problems, not review problems —
  batching, sticky summaries, overlap dedup, retrying a failed inline comment
  (see `docs/open-code-review-inceleme.md`, D19). None of them make a finding
  better.
- Running a review now means running it in CI, and CI already has a well-worn
  way to write to a pull request: a separate job with a separate token.

## Decision

The reviewer compares a branch against a base from the checkout's own git,
reviews the changed files, and **reports**. It has three renderings — text,
NDJSON, and GitHub Actions annotations plus a job summary — and no way to post
anything. It holds no repository credential; the only secret it reads is the
model's key.

A project is therefore a **checkout plus the rules that apply to it**, not a
repository on a hosting system. The catalogue's `repositories.providers` and a
project's `repository` are gone (schema v3); `local-path` is what names a
project's target, and it defaults to the current directory, which is what a CI
job wants after `actions/checkout`.

Turning findings into comments belongs to whatever reads the NDJSON. The
shipped workflow does it in a second job with `pull-requests: write` and no
model access at all.

The removed code is kept, unbuilt and gitignored, under `backup/` — see
`backup/RESTORE.md`.

## Consequences

**Good.** The process that sees untrusted input cannot write to the pull
request. A review runs identically on a laptop and in CI, because in both
places it only writes to a stream. The tool works against any hosting system,
including ones nobody has implemented, and against work that has not been
pushed. `--preview` and a full review need no network but the model's.

**Bad.** Posting is now the operator's to wire up, and the shipped workflow is
an example rather than a guarantee. Two things the posting flow knew are lost
with it: dedup against comments a pull request already carries, and the
"do not repeat what a reviewer already said" instruction in the prompt — the
reviewer no longer reads prior discussion, so a re-review can repeat itself.
The CI bot can re-learn the first from the GitHub API; the second would need
the prompt to see comments again.

**Neutral.** Volume control survives as `max-findings-per-file`, applied to
what is _reported_ rather than what is posted, and what it withholds is
counted into the run's `capped` tally rather than dropped in silence.
Severity filtering does not survive: every severity is reported, and
`--fail-on` decides only the exit code.
