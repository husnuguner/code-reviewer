# Troubleshooting

A free first check that needs no key:

```bash
reviewer review --preview --base main -v
```

It resolves the config, opens git, computes the merge-base and prints the
scope, without calling a model.

## When it does not run

| Symptom                                                            | Cause / fix                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| exit 2, `settings.llm.api-key reads '${...}', which is not set`    | Put the variable in `~/.config/reviewer/.env` (or `.review/.env`), or export it.                                                                                                                                                                                         |
| exit 2, `... is spelled like a variable's name, not a key`         | Write `api-key: ${NAME}`; a bare name is taken as the key itself.                                                                                                                                                                                                        |
| exit 2, `1 validation error for Config`                            | A setting has the wrong shape; the message names the variable.                                                                                                                                                                                                           |
| exit 2, `... is not a git repository`                              | Run inside a checkout: the one owning `.review/config.yaml`, else the working directory.                                                                                                                                                                                 |
| exit 2, `configuration param '...' not declared in the schema`     | A key the schema does not know, named by its place in the file. Every such key is listed.                                                                                                                                                                                |
| exit 2, `... sets ['skills'], which belongs to a repository's ...` | `skills` is in `~/.config/reviewer/config.yaml`; move it to the repository's `.review/config.yaml`.                                                                                                                                                                      |
| exit 2, `... declares schema version N ... up to 1`                | A config file from a newer build; upgrade the reviewer or lower `version`.                                                                                                                                                                                               |
| The model is not the one I set, or a key is refused (401)          | Every run logs `Model: <model> at <endpoint>` at INFO. Two files and the environment speak; `-v` logs which files were read, and `LLM_*` variables (a CI input among them) beat both. `local` without `base-url` is the OpenAI API, not a local server.                  |
| exit 3                                                             | Not an error: a finding matched `--fail-on`.                                                                                                                                                                                                                             |
| exit 4, `Review incomplete`, `Could not review <file>: …`          | The model did not answer for that file. The log says why: a refused key (401), a rate limit, an unreachable endpoint, or a prompt over the model's context window (the message gives the prompt's size; exclude or split the file, or use a model with a larger window). |
| exit 1 with a usage message                                        | Bad flag, or no command named (`reviewer review …`); see `--help`.                                                                                                                                                                                                       |
| exit 2, `No merge-base for HEAD and 'X'`                           | Unrelated histories, or a shallow clone. CI needs `fetch-depth: 0`; locally, fetch more history or name another `--base`.                                                                                                                                                |
| exit 2, `--base 'X' is not a commit`                               | The base is not in this clone (CI fetches `origin/<base>` itself). `git fetch origin`, or name `origin/X`.                                                                                                                                                               |
| exit 2, `No base to compare against`                               | No `origin/HEAD`, `main` or `master` here. Name one with `--base`.                                                                                                                                                                                                       |
| `0 changed file(s)` with work in `git status`                      | The work is not committed, or the branch is already merged. Use `reviewer review --uncommitted`.                                                                                                                                                                         |
| 0 findings and `files_reviewed=0`                                  | Everything was skipped; `--preview` says why, per file.                                                                                                                                                                                                                  |
| `Skill ... is in neither the project's skills.defaults nor ...`    | A loaded skill nobody scoped. Name it under a `skills.defaults` glob, map it, or switch it off with `[]`.                                                                                                                                                                |
| `Skill mapping for '…' matches no loaded skill`                    | The mapping names a skill that is not in `skills.path`; almost always a typo.                                                                                                                                                                                            |
| `Skill default for '…' matches no loaded skill`                    | A `skills.defaults` glob lists a skill that is not in `skills.path`; almost always a typo.                                                                                                                                                                               |
| `Skill budget reached for …`                                       | The fixed 200000-character ceiling on a file's skills block left a matching skill out of it, so it was not reviewed against it. Said once a skill.                                                                                                                       |
| `skills.path is empty, so no skill is loaded, but …`               | The tables scope skills the run never loads. Name the skills directory, or drop the tables.                                                                                                                                                                              |

## A branch with no commits of its own reviews nothing

The changed-file set is the three-dot diff `base...HEAD`. If your work is
still uncommitted, or the branch has already been merged into the base so the
merge-base _is_ `HEAD`, that diff is empty and the run correctly reports
`0 changed file(s)`. `git status` shows the work; `reviewer review --uncommitted`
reviews it.

## A run is slow

A slow run is almost always waiting on the model. Run with `-v`: each file's
`review` line says how long `context`, `model` and `verify` took, and each
model call logs its token counts and rate. A large `out` at the vendor's usual
rate is a long answer (lower `max-findings-per-file`); a small `out` at a low
rate is the vendor being slow. See [Output → Logging](output.md#logging).

## A finding landed on the wrong line, or on none

See [Anchoring](how-it-works.md#anchoring). The summary's `anchors` tallies
say how each reported finding's line was decided; `-v` logs each repair,
conflict and failure with the line the model claimed and the code it quoted.

## A finding I expected is missing

In order of likelihood:

1. The file was skipped: `--preview` names the reason.
2. The file was skipped as `too_large`: `--preview` names it. Exclude it or
   split the change.
3. Verification removed it (`refuted` in the summary): `-v` logs the ground;
   `--no-verify` shows what the reviewer said before the pass.
4. The cap withheld it (`capped` in the summary): raise
   `max-findings-per-file`.
