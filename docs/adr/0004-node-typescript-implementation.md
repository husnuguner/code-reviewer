# The reviewer is a Node.js/TypeScript program

The reviewer was first written in Python (3.13, `pydantic-settings`,
`unidiff`, `httpx`, an `AgentScope` wrapper around the OpenAI and Anthropic
SDKs). This repository is a full re-implementation in TypeScript on Node.js,
with the Python behaviour as its specification: 759 input/output fixtures were
frozen from the Python modules before a line was ported, and the two programs
produce identical NDJSON records, text reports, review bodies and posted
comments on the same change set against the same model.

## Why move

- **One language with the reviewed code and the coming UI.** The repositories
  this tool reviews are TypeScript; the review skills, the GitHub payloads and
  the model's JSON are all easier to reason about from the same type system,
  and a web UI that shows runs, findings and projects should share the core
  rather than shell out to a second runtime.
- **The Python framework carried no weight.** AgentScope was used for one
  message container and two client wrappers (~15 lines), and it quietly sent
  the system prompt as a _user_ message. The Node implementation uses the
  AI SDK's provider abstraction behind a two-method port and sends a real
  system message.
- **Composition over convention.** The Python design was already ports and
  adapters; TypeScript's structural typing and a small container (`awilix`)
  make the seams explicit: `core/` never imports an adapter, and ESLint
  enforces that.

## Considered options

- **Keep Python, add a Node UI over it.** Rejected: two runtimes to install,
  two dependency trees to secure, and the UI would consume stdout rather than
  the domain model.
- **Port to Go.** Rejected: the model SDK and diff-parsing ecosystems are
  thinner, and none of the reviewed code is Go.
- **Vendor SDKs directly (`openai`, `@anthropic-ai/sdk`).** Rejected in favour
  of the AI SDK: one `LanguageModel` interface for every vendor means a new
  provider is a fifteen-line file, and the review layer sees only
  `generate(messages) -> text`.
- **`minimatch`/`picomatch` for skill globs.** Rejected: their dialects differ
  from the Python `full_match` rules the skills were written against (`**`
  semantics, `[!...]`, dot-files). The glob engine is implemented to match the
  frozen fixtures instead.
- **A hand-written diff parser.** Deferred: `parse-diff` tokenises well enough
  and an adapter restores the hunk-header and no-newline semantics the review
  needs. It remains the one dependency whose replacement would be a single
  file.

## Deliberate divergences from the Python behaviour

Everything not listed here is identical, record for record.

1. **System prompt role.** Sent as a real system message (`instructions` in
   the AI SDK; `system` for Anthropic). Python sent it as a user message.
2. **Unknown catalogue keys** are rejected when `config.json` is parsed, for
   project, repo-provider and auth entries alike (zod strict objects). Python
   rejected only project keys, and only when a project was resolved -- so
   `reviewer projects` listed a typo'd file where this implementation refuses
   it. The root object stays open for the `_readme` key `init` writes.
3. **`.env` locations.** Python read the _package's own_ repository root
   `.env` (an editable-install artefact) below the config-home `.env`. This
   implementation reads the **current working directory's** `.env` in that
   slot, which is what "the repo-root `.env` still works" was meant to say.
4. **Configuration errors** surface as a plain `error:` line and exit code 2,
   like catalogue and git errors. Python let pydantic's `ValidationError`
   escape as a traceback.
5. **A float line number** from the model (`"line": 2.0`) is read as the
   integer 2, so it counts as the claimed line; Python read it as "no line"
   and repaired the finding from its quote.
6. **`"findings": null`** in a model answer yields no findings; Python raised.
7. **JSON output** is semantically identical but not byte-identical to
   Python's `json.dumps` separators. NDJSON consumers parse lines, so no
   consumer sees a difference.

## Consequences

The toolchain is pinned with Volta (`node` 24, `npm` 11). Type checking runs
on the native TypeScript 7 compiler while editors, `typescript-eslint` and
vitest use the TypeScript 6 API, because TypeScript 7.0 ships no JavaScript
API yet; when `typescript-eslint` supports the 7.x API the second package goes
away. Linting is ESLint 10 with type-aware rules, including the layering
rules that keep `core/` free of adapters.

The Python fixtures stay in `tests/fixtures/` as the behavioural contract.
They are the specification this implementation is measured against, and the
place to look when a future change is meant to alter behaviour on purpose.
