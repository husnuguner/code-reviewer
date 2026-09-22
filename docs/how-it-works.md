# How it works

This page follows one run from `git diff` to the last report record. For the
CLI surface see the [README](../README.md); for every setting see
[Configuration](configuration.md).

## Pipeline

```
local git ──▶ select ──▶ per file: context ▸ model ▸ anchor ▸ verify ──▶ cap ──▶ report
              (pure)      (parallel, bounded)                             (stream)
```

1. **Read the change set** from local git: the three-dot diff `base...HEAD`
   (or the working tree against `HEAD` with `--uncommitted`). The reviewed
   side is always the checkout: the diff, the file contents and the
   pre-context are read from one tree.
2. **Select** which files are reviewed and why the others are not. One pure
   function; `--preview` prints its output and stops.
3. **Review each selected file** (in parallel, bounded by
   `max-concurrent-files`):
   - match the project's [skills](configuration.md#review-skills) to the path;
   - read the file's full text and gather [pre-context](#pre-context) from the
     checkout;
   - ask the model once, with the annotated diff and the output contract;
   - [anchor](#anchoring) each finding to a line;
   - [verify](#verification) the findings against the diff (a second call,
     only when there is something to check).
4. **Cap** the volume per file; the most severe survive.
5. **Report** each finding as soon as its file finishes, then one summary
   record.

## Scope, and previewing it

Which files a run reviews is decided once, before anything is prompted
(`src/core/review/selection.ts`). Every file that is not reviewed carries a
reason:

| Reason           | Meaning                                                                                      |
| ---------------- | -------------------------------------------------------------------------------------------- |
| `secret`         | The path names a credential file. Never read, never prompted.                                |
| `binary`         | Git could not express the patch as text.                                                     |
| `status`         | `removed` or `renamed`: nothing to comment on.                                               |
| `excluded`       | Matched one of the project's `exclude` globs.                                                |
| `no_added_lines` | The patch adds no lines, so no comment could be anchored.                                    |
| `no_patch`       | The record carried no path or no patch.                                                      |
| `too_large`      | The diff is over the built-in ceiling (200,000 chars). Exclude the file or split the change. |

The gates are asked in that order and the first one that answers wins, so a
credential the project also excluded is still reported as a credential.

Nothing is cut. A file is reviewed whole or skipped as `too_large`; the
ceiling is a constant, not a setting. The file's full text is attached whole
too, or, past the same ceiling, not at all -- the log says so and the diff
alone is reviewed.

`--preview` runs the same function and prints the decisions:

```text
=== [PREVIEW] HEAD vs main ===
4 changed file(s); 1 to review, 3 skipped.

  review   src/api/users/handler.ts  +37
  skipped  .env                      credential file
  skipped  legacy/old-handler.ts     status=removed
  skipped  package-lock.json         excluded

skipped: excluded=1, secret=1, status=1
No model was called.
```

Because it is the same function the real run acts on, what it promises is
what gets reviewed, and it needs no credentials.

### What is never sent to the model

Two exclusions are not the project's to make (`src/core/review/guards.ts`):

- **Credential files** — a built-in, case-insensitive list of paths whose
  purpose is to hold a secret: `**/.env`, `**/.env.*`, `**/*.env`,
  `**/*.pem|key|p12|pfx|jks|keystore`, `**/id_rsa|id_dsa|id_ecdsa|id_ed25519`,
  `**/.ssh/**`, `**/.aws/**`, `**/.gnupg/**`, `**/.netrc`, `**/.npmrc`,
  `**/.pypirc`, `**/.dockercfg`, `**/.docker/config.json`,
  `**/.git-credentials`, `**/.htpasswd`. A match is skipped before anything is
  read and named in the log at INFO. `exclude` can add to this list; nothing
  can take away from it.
- **Binary patches** — git's binary marker, or any patch carrying a NUL byte.

`.env.example` is withheld too: a template with a live value pasted into it
is a leak no rotation undoes.

There is deliberately no extension allowlist. Lockfiles, generated code and
snapshots are the project's judgement and belong in its `exclude`.

## Pre-context

A diff rarely explains itself. Before each call the reviewer fetches, from the
checkout at the reviewed ref:

| Block           | What                                                                                                      | Answers                                             |
| --------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| **Definitions** | Exported signatures (with doc comments) of the local modules the added lines import                       | "What does the thing I am calling take and return?" |
| **Usages**      | Paths of other files that mention an exported symbol the change adds, removes or edits                    | "Does this signature change break anyone?"          |
| **Related**     | Diffs of the other changed files beside this one (same directory, or same stem: `foo.ts` / `foo.test.ts`) | "Was the counterpart updated too?"                  |

Pre-context is deterministic: the reviewer decides what to fetch and the model
asks for nothing, so the review stays one call and the output contract is
untouched. The block is capped by `max-context-chars` (default 6000; `0`
switches it off) and read through local git (`git show`, `git grep`).

Related diffs are built from the _selected_ files, so an excluded or
credential file can never reach a prompt as somebody else's "related change".

## The prompt

Each call is three messages at most, stable prefix first:

1. the standing prompt — the reviewer's policy (`prompts/system.md`), the
   repository's [standing instructions](configuration.md#standing-instructions)
   and the output contract (`prompts/output-contract.md`);
2. the skills block for this path, if any;
3. the file: its annotated diff, allowed line numbers, full text, pre-context
   and the question.

The model sees the diff with every added line prefixed by its new-file line
number:

````text
File: src/api/users/handler.ts

Allowed line numbers (you may ONLY use these in findings):
41, 42, 43

Unified diff (added lines prefixed with [L<n>]):
```diff
@@ -38,6 +38,9 @@
   export async function updateUser(req, res) {
+[L41]   const body = req.body;
+[L42]   await users.update(req.params.id, body);
+[L43]   res.status(204).end();
```
````

and answers with JSON only:

```json
{
  "findings": [
    {
      "line": 41,
      "existing_code": "  const body = req.body;",
      "severity": "bug",
      "body": "`req.body` is read directly; the validated payload is `req.validatedBody`.",
      "example": ""
    }
  ]
}
```

Severity is one of `bug`, `security`, `performance`, `readability`. A finding
whose severity is outside that vocabulary is kept under the mildest one and
counted as `mislabelled`.

### What a run pays for twice, and does not have to

Most of what one file's review sends is not about that file: the standing
prompt and the skills block are sent again, byte for byte, by the next file.
The reviewer orders each call stable prefix first and marks those messages as
such (`ChatMessage.stable`).

- **Anthropic** is told to cache them. The standing prompt is written on the
  run's first call and read on every later one; each distinct skills block
  likewise. A twenty-file pull request pays for the standing prompt once. A
  cache write costs a quarter more than sending plain, a read a tenth, and the
  cache lives five minutes from its last use, so caching pays from the second
  file on. Blocks under the vendor's minimum (about a thousand tokens) are
  silently not kept.
- **OpenAI-compatible endpoints** are told nothing; the ones that cache do so
  unasked.

Whether it happened is in the log: `-v` prints each call's
`tokens in (7,650 cached)` or `(7,650 cache written)`.

## Anchoring

A finding is only useful where it lands. The model gives two independent
signals per finding: the `line` it read off the `[L<n>]` markers, and
`existing_code`, a verbatim quote of the lines it is talking about. The quote
is matched against the diff's new side, and the two settle each other:

| `anchor`   | What happened                                                                                                               |
| ---------- | --------------------------------------------------------------------------------------------------------------------------- |
| `exact`    | The line is commentable and the quote agrees (or matched nothing usable).                                                   |
| `repaired` | The line was missing or outside the diff, and the quote matched exactly one place. The finding is saved instead of dropped. |
| `conflict` | The line is commentable but the quote points elsewhere. The line is kept and the disagreement counted.                      |
| `failed`   | Neither signal yields a line. The finding is reported without one, and the report says so.                                  |

A quote spanning several added lines becomes a multi-line anchor
(`start_line`..`line`); one that caught context lines is narrowed to the added
lines inside it.

Both signals are read against the diff the model was shown. The allowed line
numbers, the quote matcher's haystack and the annotated diff come out of one
decision (`patchView`), so the model cannot be told it may comment on a line
it was never sent.

The line wins a `conflict` because it is copied from a marker printed beside
the code, whereas a quote can match a repeated idiom elsewhere by luck. Every
run reports the tallies, so how often the question arises is measurable.

## Verification

Anchoring decides _where_ a finding lands; verification decides _whether it
survives_. Once a file is reviewed, its findings go back to the model with
that file's diff and one question: which of these does this diff prove wrong?
Only removals come back, so verification can never invent, reword or re-rate
a finding.

The two mistakes are not equally bad. Keeping a wrong finding costs the author
a few seconds; removing a right one destroys it silently. The shipped policy
(`prompts/verify.md`) therefore:

- admits exactly **two** grounds for removal — the finding is about code that
  is not in the diff, or a diff line contradicts its central claim in plain
  text;
- vetoes the subjects where a wrong removal is most expensive (memory and
  lifetime, concurrency, behavioural change, declaration consistency, an
  unused parameter);
- answers "keep" whenever the evidence falls short.

**Every failure keeps the finding**: a failed call, an unparseable reply, an
out-of-range index all leave it standing.

It costs one extra model call per file that found something; a clean file
costs nothing. Runs report what it removed as `refuted`. `--no-verify` turns
it off for one run, `verify: false` for a project.

## How much is reported

`max-findings-per-file` (default 3; `0` = no cap) caps how many findings one
file reports. When it bites, the most severe survive and the rest are counted
into `capped`.

The model is told the cap too, in the same severity order, and asked not to
shorten or merge findings to fit. A completion's wall time is its output, so
generating twelve findings to report three is the difference between eighty
seconds and twenty on a slow model. The cut after the call still stands;
`capped` says how often the model overran.

Two consequences: a finding verification removes is not replaced, so a capped
file can report fewer than the cap; and with `0` the model is asked for no
limit.

Severity filters nothing: every severity is reported. It decides the
annotation colour in CI and, only if asked, the exit code via `--fail-on`.

## Nothing is dropped in silence

Every path a finding or a file can take out of the report leaves a number
behind:

| Counter       | What it counts                                                    |
| ------------- | ----------------------------------------------------------------- |
| `skipped`     | Files not reviewed, by reason.                                    |
| `failed`      | Files selected for review whose review threw.                     |
| `refuted`     | Findings the verification pass removed.                           |
| `capped`      | Findings the volume policy withheld.                              |
| `mislabelled` | Reported findings re-rated because the model invented a severity. |
| `unanchored`  | Reported findings that have no line.                              |
| `anchors`     | How each reported finding's line was decided.                     |

A run that reviewed nothing says which kind of silence that was, rather than
"No issues found." See [Output](output.md) for the record shapes.

## When the change edits the policy

The repository's `.review/` -- its config, standing instructions and skills
-- is read as instructions, not as data: it decides what is excluded and what
the model is told. A change set that edits it can therefore weaken the review
that reads it: `exclude: ["**"]` reviews nothing, a rewritten skill asks for
nothing.

So every run compares the change set against the policy's paths -- `.review/`
always, plus the config file, prompts and skills the run was actually given
when they lie inside the checkout -- and names what it finds. The summary
record carries `policy_changed`, a sorted list of those files (`[]` when
none); the text report and the job summary say so before the findings; the
posted comment opens with it; `--preview` shows it for free. The files
themselves are still reviewed like any other. An excluded policy file still
counts: it changed, whether or not it was reviewed.

That is a warning, not a defence. The defence is in CI: the
[review action](github-action.md#the-policy-is-the-base-branchs) reads
`.review/` from the base branch, so a pull request is held to the rules it
is trying to change.
