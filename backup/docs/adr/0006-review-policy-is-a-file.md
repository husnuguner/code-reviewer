# The review policy is a file the operator owns; the output contract is not

## Context

The system prompt did two jobs in one string constant: it said who the
reviewer is and what it looks for (persona, the four lenses, what is out of
scope), and it said how the diff is presented and exactly which JSON must come
back (`[L<n>]` numbering, the `findings` schema, the verbatim `existing_code`
rule). The first half is opinion an operator legitimately wants to change per
organisation; the second half is what the parser and the anchor resolver are
built against. Keeping both in code meant a policy change was a code change,
and letting both be configured meant one edit could silently break parsing.

## Decision

- The prompt texts live in files, not in code: `prompts/system.md` (the
  policy) and `prompts/output-contract.md` (the contract) at the package root,
  shipped with the package. The core composes them
  (`systemPrompt(policy, contract)`) and fills the contract's
  `{{severities}}` from the one severity vocabulary.
- The catalogue's **`prompts`** setting (in `defaults`, overridable per
  project -- the list replaces, it does not append) names the policy files
  the operator wants instead. Their text, concatenated in order, replaces the
  shipped policy. Relative paths are taken from the catalogue's directory;
  a file that cannot be read is a configuration error at startup.
- `reviewer init` writes the shipped policy to `prompts/system.md` beside
  `config.yaml` and points `defaults.prompts` at it, so from the first run
  the policy is a file the operator can edit. An existing file is never
  overwritten.
- **The output contract is not configurable.** It is appended to whatever
  policy is in force.

## Consequences

- Every sentence of the reference system prompt is kept; the two halves are
  regrouped (policy first, contract last) and the two `Rules:` headers are
  now `Review rules:` and `Output rules:`. The `prompts/system_prompt`
  fixture is a documented divergence; a test checks the sentence set is
  unchanged.
- The reading of policy files is an adapter (`src/infra/prompts/`); the core
  receives a composed string and stays free of I/O.
- A policy written in another language or for another stack needs no code
  change and cannot break the JSON the reviewer relies on.
