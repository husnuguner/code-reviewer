# One YAML catalogue carries every setting; the environment overrides it

## Context

The Python reference configured a run from environment variables, with an
optional JSON catalogue for the repository side. In use, the operator's
settings ended up split across a `.env` (model, key, language, excludes, the
target repository) and a `config.json` (connections, projects), and the JSON
could carry no comments -- so the annotated reference had to be a separate
file that could not be copied as-is.

## Decision

- The catalogue is **`~/.config/reviewer/config.yaml`**, keys in
  **kebab-case**. YAML reads JSON, so a `config.json` from before the change
  still loads, and is picked up when no `config.yaml` exists.
- It carries **every setting**, the model included: `defaults.llm`
  (`provider`, `model`, `base-url`, `api-key`), overridable per project key by
  key. `local-path`, the checkout branch review reads, is a project setting.
- A **secret** setting (`auth.token`, `llm.api-key`) takes either the name of
  an environment variable -- spelled like one, `^[A-Z_][A-Z0-9_]*$` -- which
  is then read from the environment and the `.env` files, or the value
  itself. Naming keeps the file shareable; the choice is the operator's.
- The **environment is the override layer**: an exported `LLM_*`/`REVIEW_*`
  variable beats the catalogue for every project. Consequently the variables
  a catalogue names should be called after what they hold
  (`ANTHROPIC_API_KEY`), not `LLM_API_KEY`, or the `.env` would override a
  project that uses another key.
- `reviewer init` writes a starter from `templates/config.yaml`, shipped with
  the package like the prompts; no configuration text lives in code. The
  complete, annotated reference is `docs/config.example.yaml`, parsed by a
  test so it cannot drift.

## Consequences

- A normal setup is one directory: `config.yaml`, a two-line `.env`,
  `prompts/`, `skills/<project>/`.
- Without a catalogue the environment still describes a whole run, as before.
- The `catalog` and `commands` fixtures are hand-maintained for the YAML
  format; the parser's contract is otherwise unchanged.
