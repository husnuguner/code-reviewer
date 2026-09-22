# Output

The reviewer writes a **report** to stdout and **logs** to stderr. They never
share a stream, so `--format ndjson` parses line by line however loud the run
is.

## Formats

| `--format` | Goes to              | For                                                                                                                       |
| ---------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `text`     | stdout               | A human at a terminal (the default).                                                                                      |
| `ndjson`   | stdout               | A program: one record per line, flushed as each file finishes.                                                            |
| `github`   | stdout + job summary | A GitHub runner: `::error`/`::warning` annotations on the changed lines, plus a Markdown table in `$GITHUB_STEP_SUMMARY`. |

`--out PATH` writes the NDJSON stream to a file **in addition** to whatever
`--format` prints. CI wants findings on the diff _and_ a machine copy for the
bot that posts comments, and a model call is too expensive to make twice.

### Text

````text
=== Branch review: HEAD vs main ===
3 finding(s) across 2 file(s).
anchors: 1 repaired

src/api/users/handler.ts:41
  **[Bug/correctness]** `req.body` is read directly; the validated payload is
  `req.validatedBody`. A client can send fields the schema never allowed.
  (skills: api-conventions, error-handling)

src/api/users/handler.ts:58
  **[Performance]** `users.findAll()` is called inside the loop; hoist it or
  pass the ids as one `IN` query.
  ```
  const byId = new Map((await users.findAll()).map((u) => [u.id, u]));
  ```

src/lib/cache.ts  (no line anchor)
  **[Readability]** `ttl` is documented in seconds but compared against `Date.now()` in milliseconds.
````

The `(skills: …)` line names the skills that were in the prompt for that file
-- what it actually carried, so a skill the
[per-file budget](configuration.md#review-skills) left out is not among them,
and a warning names it instead. A finding that could not be anchored is listed
with `(no line anchor)`.
When files failed, or the change edits the review policy, the header says so
before the findings.

## NDJSON contract

The NDJSON stream is the machine contract. Consumers such as
`reviewer comment` read it; anything else may too.

One `finding` record per finding, as each file's review completes:

```json
{
  "type": "finding",
  "path": "src/api/users/handler.ts",
  "line": 41,
  "start_line": null,
  "anchor": "exact",
  "severity": "bug",
  "body": "`req.body` is read directly; the validated payload is `req.validatedBody`.",
  "example": "",
  "skills": ["api-conventions"]
}
```

| Field        | Type           | Meaning                                                                                   |
| ------------ | -------------- | ----------------------------------------------------------------------------------------- |
| `path`       | string         | The changed file, as git names it.                                                        |
| `line`       | number \| null | New-file line the finding is anchored to; `null` when it could not be anchored.           |
| `start_line` | number \| null | First line of a multi-line anchor; `null` for a single line.                              |
| `anchor`     | string         | `exact`, `repaired`, `conflict` or `failed` — see [Anchoring](how-it-works.md#anchoring). |
| `severity`   | string         | `bug`, `security`, `performance` or `readability`.                                        |
| `body`       | string         | The comment, in the configured language.                                                  |
| `example`    | string         | A short fix snippet, or `""`.                                                             |
| `skills`     | string[]       | The skills the prompt carried for this file; one the budget left out is not listed.       |

Then exactly one `summary` record:

```json
{
  "type": "summary",
  "base": "main",
  "branch": "HEAD",
  "incremental": false,
  "files_changed": 6,
  "files_reviewed": 4,
  "failed": 0,
  "findings": 3,
  "files_with_findings": 2,
  "anchors": { "exact": 2, "repaired": 1 },
  "unanchored": 0,
  "refuted": 1,
  "capped": 0,
  "mislabelled": 0,
  "bypassed": 0,
  "skipped": { "excluded": 1, "secret": 1 },
  "policy_changed": [],
  "bypass_regions": []
}
```

| Field                 | Meaning                                                                                                                                                                                               |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `base`, `branch`      | What was compared: `--base` and `"HEAD"`. An `--uncommitted` run reports `"HEAD"` and `"working tree"`; a `--since` run reports the commit it started from and `"HEAD"`.                              |
| `incremental`         | `true` for a `--since` run, which reviewed only the commits after `base`; a clean result then says nothing about findings earlier runs reported. `reviewer comment` does not supersede on such a run. |
| `files_changed`       | Files in the change set.                                                                                                                                                                              |
| `files_reviewed`      | Files whose review came back.                                                                                                                                                                         |
| `failed`              | Files selected for review whose review threw.                                                                                                                                                         |
| `findings`            | Findings reported.                                                                                                                                                                                    |
| `files_with_findings` | Distinct paths among them.                                                                                                                                                                            |
| `anchors`             | Reported findings by anchor outcome.                                                                                                                                                                  |
| `unanchored`          | Reported findings with `line: null`.                                                                                                                                                                  |
| `refuted`             | Findings the verification pass removed before they were reported.                                                                                                                                     |
| `capped`              | Findings `max-findings-per-file` withheld.                                                                                                                                                            |
| `mislabelled`         | Reported findings whose severity the model spelled outside the vocabulary (kept under the mildest one).                                                                                               |
| `bypassed`            | Findings that fell in a region a [`reviewer: by-pass` marker](how-it-works.md#bypassing-a-block-from-the-code) took out of review; dropped before verification.                                       |
| `skipped`             | Files not reviewed, by reason: `secret`, `binary`, `status`, `excluded`, `no_added_lines`, `no_patch`, `too_large`, `bypassed` (every added line in a bypassed region; no model call).                |
| `policy_changed`      | The review-policy files this change edits (`.review/**` and the run's own), sorted; `[]` when none.                                                                                                   |
| `bypass_regions`      | The regions markers took out of review: `{ path, start_line, end_line, reason }`, by path then line; `[]` when none. Listed whether or not a finding fell in them.                                    |

The counters close:

```text
files_changed = files_reviewed + failed + sum(skipped)
```

`anchors`, `unanchored` and `mislabelled` are counted over the findings that
were **reported**, so they describe the same population as `findings`. What
never got that far is `bypassed`, `refuted` and `capped`, in that order: a
finding in a bypassed region is dropped before the verifier sees it.

While the major version is 0, any release may change this contract; see
[Versioning](../README.md#versioning).

## Exit codes

| Code | Meaning                                                                           |
| ---- | --------------------------------------------------------------------------------- |
| `0`  | Success.                                                                          |
| `1`  | Usage error, or a refused `init`.                                                 |
| `2`  | A configuration or working-tree problem the operator can fix (one `error:` line). |
| `3`  | A reported finding matched `--fail-on`.                                           |

`--fail-on` is asked of the _reported_ findings: one that verification refuted
or the cap withheld cannot fail a build the reviewer never showed it to.

## Logging

Logs describe how the run went; the report is what it found. Every log line
goes to stderr. The flags live on the root command, so every subcommand takes
them in the same place.

| Flag                  | Effect                                                                                                         |
| --------------------- | -------------------------------------------------------------------------------------------------------------- |
| `-v`, `--verbose`     | DEBUG detail for `reviewer.*` (per-file decisions, skill matches), with local clock times and component names. |
| `-q`, `--quiet`       | Warnings and errors only. The report is unaffected.                                                            |
| `--log-level LEVEL`   | `debug`, `info` (default), `warn`, `error`, `silent`. Outranks `-v` and `-q`.                                  |
| `--log-format FORMAT` | `auto` (default), `text`, `json`, `github`.                                                                    |
| `--no-color`          | Never colour log lines.                                                                                        |

By default a line is the sentence and its level; `-v` adds the record around
it:

```console
$ reviewer review --base main
info: Loaded 3 skill(s): api-conventions, error-handling, tests
warn: No merge-base for 'HEAD' and 'main'; comparing against 'main' directly.

$ reviewer review --base main -v
11:12:59.341  debug  reviewer.config: Read repo config file .review/config.yaml: 3 key(s).
11:12:59.342  info   reviewer.skills: Loaded 3 skill(s): api-conventions, error-handling, tests
11:13:41.902  debug  reviewer.review.file_reviewer: src/api/users/handler.ts: the model answered in 77.7s (attempt 1 of 2; 9,445 tokens in (7,650 cached), 2,410 out, 31 tokens/s).
11:14:00.017  debug  reviewer.review.verify: src/api/users/handler.ts: the verifier answered in 18.1s for 9 finding(s) (3,210 tokens in, 181 out, 10 tokens/s).
11:14:00.019  info   reviewer.review.changed_file: review src/api/users/handler.ts: +85 line(s), skills=["api-conventions"], 3 finding(s) (context 0.2s, model 77.7s, verify 18.1s).
```

The per-file `review` line carries how long each waiting step took:
`context` (reading the repository for pre-context), `model` (the review call,
retries included) and `verify` (absent when verification is off). The token
line is the diagnosis for a slow run: a large `out` at the vendor's usual rate
is a long answer; a small `out` at a low rate is the vendor being slow. The
parenthesis after `tokens in` is what a cached prefix saved (`cached`) or cost
(`cache written`). A retried call says why
(`The model answered 529; retrying in 1240ms`).

### Formats

`auto` resolves to `github` on a runner and `text` everywhere else.

| Format   | A line looks like                                                      | For                                   |
| -------- | ---------------------------------------------------------------------- | ------------------------------------- |
| `text`   | `warn: No merge-base for 'HEAD' and 'main'`                            | A person.                             |
| `json`   | `{"level":"warn","name":"reviewer.review","msg":"…","time":"2026-…Z"}` | A log collector; one record per line. |
| `github` | `::debug::Read repo config file .review/config.yaml: 3 key(s).`        | A GitHub runner.                      |

### Environment

The reviewer defines no logging variable of its own: level and format are the
flags' to say, so a run's log settings are always visible on the command line
that asked for them. What it reads are the conventions other tools own:

| Variable                             | Effect                                                                                               |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `NO_COLOR`                           | Set to anything non-empty: no colour. Outranks `FORCE_COLOR` ([no-color.org](https://no-color.org)). |
| `FORCE_COLOR`                        | Set to anything non-empty (even `0`): colour even when stdout is not a terminal.                     |
| `TERM=dumb`                          | No colour off a terminal that cannot show it.                                                        |
| `CI`                                 | Set to anything non-empty: colour, as CI logs render ANSI.                                           |
| `RUNNER_DEBUG`, `ACTIONS_STEP_DEBUG` | Set by a GitHub job re-run with debug logging: the run switches to DEBUG by itself.                  |
| `GITHUB_ACTIONS`                     | Makes `--log-format auto` resolve to `github`.                                                       |

Colour is [picocolors](https://github.com/alexeyraspopov/picocolors)' verdict, decided once at
start-up against **stdout** (Windows always colours). `--no-color` outranks all of it.

### Secrets never reach a log line

Every value in the environment held by a variable whose name says it is a
credential (`*_API_KEY`, `*_TOKEN`, `*_SECRET`, `*_PASSWORD`, …) is masked as
`***` at the sink, in every format, so a message that interpolated a key
cannot leak it into a CI log.
