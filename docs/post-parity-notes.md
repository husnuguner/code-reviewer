# Post-parity notes

Observations made while porting that are **not** part of the parity target.
Each is a candidate for a later request unless listed under "Implemented".

## Implemented after parity

- **Catalogue schema v2** ([ADR 0005](adr/0005-skill-scope-in-the-catalogue.md)):
  kebab-case keys; connections under `repositories.providers` with
  `auth.token`; a root `defaults` section every project starts from (project >
  defaults > built-in; `max-findings-per-file` defaults to 3); a project's target
  is `repository: { provider, name }`; skills are one section,
  `skills: { path, mappings }`, where `path` may be a directory on the
  reviewer's machine and `mappings` (skill name → globs) replaces frontmatter
  `applies_to`; `lang` is `language`, `inline_severities` is `severities`;
  list settings are lists; optional keys are omitted, not `null`. The `catalog`/`commands` fixtures are hand-maintained from here on.

- **Credential and binary guards** (`src/core/review/guards.ts`): a built-in
  list of credential paths (`.env*`, private keys and key stores, `.ssh/`,
  `.aws/`, `.npmrc`, `.git-credentials`, …) and binary patches are skipped
  before any prompt is built. Unlike every other exclusion these are not
  configurable — an `exclude` glob can add to them, nothing narrows them. No
  extension allowlist was taken with them, on purpose: a file silently
  unreviewed is a failure an operator cannot see.

- **One scope decision, and `--preview`**
  (`src/core/review/selection.ts`): the exclusions used to be spread over
  three files (credential and binary guards plus `exclude` inside the per-file
  step, a missing patch in the orchestrator's own loop, the `max-file-chars`
  cut somewhere else again) and none of them carried a reason. They are now
  one pure `selectFiles(entries, settings) -> FileDecision[]`, with a reason
  per file (`no_patch`, `secret`, `binary`, `status`, `excluded`,
  `no_added_lines`) and a `truncated` flag for a diff that was cut rather than
  dropped — there is deliberately no `too_large` skip. `--preview` prints
  those decisions and calls no model, so it needs no LLM credential (and in
  `--branch` mode no credentials at all); it consumes the same function the
  run acts on, so it cannot promise work the run would skip. Two surfaces
  gained a tally the Python reference does not have: the PR counters line
  prints `skipped_<reason>=<n>` and `truncated=<n>` when they happened, and
  the branch-review `summary` record carries a `skipped` map — so
  `docs/parity/branch-review.ndjson` documents the older shape. One fix came
  with it: the change set handed to the model (whose pre-context may quote
  _other_ files' diffs) is now built from the selected files, so an excluded
  or credential file can no longer reach a prompt as somebody else's
  "related change".

- **The verification pass** (`verify`, `REVIEW_VERIFY`, `--no-verify`): after a
  file is reviewed, its findings and its own diff go back to the model with one
  question — which of these does this diff prove wrong? Only removals come
  back, and every failure (a failed call, an unparseable reply, an index naming
  no finding) keeps every finding. Two surfaces gained a tally: the PR
  counters line prints `refuted=<n>` when the pass removed something, and the
  branch-review `summary` record carries a `refuted` field — which the Python
  reference's NDJSON does not have, so `docs/parity/branch-review.ndjson`
  documents the older shape.

## Deliberate divergences from the Python reference (decided during the port)

These are the places where the Node port intentionally does not reproduce the
Python behaviour. Each is recorded in ADR 0004 as well.

1. **System prompt is sent as a real system message.** The Python code built
   `UserMsg("system", SYSTEM_PROMPT)`, which AgentScope reads as `role=user,
name="system"`; Anthropic therefore never received a `system` parameter.
   The port uses the AI SDK `instructions` field (OpenAI `role: system`,
   Anthropic `system`).
2. **Unknown project keys are rejected when `config.json` is parsed** (zod
   `.strict()` on project, repo-provider and auth entries), not when a project
   is resolved. `reviewer projects` therefore fails on a typo'd project where
   Python would list it. The root object stays loose so the `_readme` key the
   `init` skeleton writes keeps working.
3. **JSON output is semantically, not byte-for-byte, identical.** Python's
   `json.dumps` writes `", "` / `": "` separators; `JSON.stringify` does not.
   NDJSON consumers parse each line, so the records are equal.

## Improvement candidates (kept out of the port on purpose)

- **Retry turn omits the model's bad reply.** `RETRY_PROMPT` ("Your previous
  reply was not valid JSON") is appended without the assistant message it
  refers to, so the model never sees what it got wrong. Adding the assistant
  turn is a one-line change in `file-reviewer`.
- **Structured output.** The AI SDK's `Output.object({ schema })` could replace
  text + `_extract_json` for providers that support JSON schema; local servers
  often do not, so this needs a capability flag per provider.
- **Non-integer `line` from the model.** Python treats `2.0` as "no line"
  (`isinstance(2.0, int)` is false) and repairs the finding from its quote;
  `JSON.parse("2.0")` is the integer `2`, so here the claimed line stands and
  a disagreeing quote is counted as a `conflict`. Harmless, but the two
  disagree on that input.
- **Malformed git diff.** unidiff raises on a hunk whose line counts do not
  add up (`GitError: could not parse the git diff`); parse-diff never throws.
  The port mirrors parse-diff. Real `git diff` output never triggers either.
- **`.env` interpolation.** pydantic-settings reads `.env` through
  python-dotenv with `${VAR}` interpolation on; npm `dotenv` does not expand.
  Nobody relies on it today.
- **argparse vs commander exit codes.** argparse exits 2 on a usage error;
  commander exits 1. Operator-facing errors (`CatalogError`, `GitError`) exit 2
  in both.
- **Anthropic `max_tokens`.** AgentScope defaulted to 8192; the AI SDK
  provider defaults to the model maximum. Findings JSON is small either way.
- **Unrelated branch (no merge-base).** The flow logs "comparing against
  `base` directly" and then still runs the three-dot `base...branch` diff,
  which git refuses for unrelated histories, so the run ends in a `GitError`.
  The intended fallback is the two-dot `base branch` diff; a one-line change
  in `iterBranchReview`, kept out of the port because it changes behaviour.
- **Octokit inside the GitHub adapter.** Considered and deferred: the port's
  retry/paging behaviour is the tested contract, and the hexagonal port makes
  the swap an isolated change later.
