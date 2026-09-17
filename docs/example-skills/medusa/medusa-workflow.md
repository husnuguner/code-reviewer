---
name: medusa-workflow
description: Review MedusaJS 2.x workflows and steps — naming, step verbs, composition-body legality, compensation shapes, entity locks, and the pitfalls tsc misses.
framework: medusa
---

## Naming
- Workflows live in `src/workflows/**` and also `export default`; steps live under `steps/` and do not. Ids are stable strings. File, export and id spelling follow the house shapes (`<verb>-<noun>.workflow.ts` / `<verbNoun>Workflow`) but are never a finding
- Input and output types are explicit: `<Name>Input` / `<Name>StepInput` (plus the result type when it is not `void`) declared at the top of their own file. It moves to `types/workflow.ts` / `types/step.ts` only once a second file imports it (a `validate-*` step and the step it guards, a step and a util). Older families that keep every input in `types/step.ts` stay as they are
- A workflow gets its own folder with `steps/` and `types.ts` only when its steps are meaningless outside that flow; root `steps/` holds reusable steps, `src/workflows/common/` holds cross-domain ones
- Verbs: `start-*` opens a process leg, `complete-*` closes it, `finalize-*` is terminal, `advance-*` moves a state machine one step, `process-*` handles an outcome, `get-*` is read-only

## Step verbs (the table is the rule)
Reads, no compensation: `get-*` one row by id, throws `NOT_FOUND` · `find-*` a list by `{ filters, config }`, returns `[]` · `query-*` `query.graph` passthrough with pagination · `lookup-*` soft cross-module read, returns `null` · `resolve-*` derives a decision from several reads, throws when derivation is impossible · `validate-*` guard, reads allowed but never writes, throws `MedusaError` and returns `StepResponse(void 0)` · `evaluate-*` the soft twin of validate, returns the outcome as data · `compute-*` pure math, returns ISO strings.

Writes, compensation required: `create-*` insert → delete by id · `update-*` partial update → restore prior fields · `set-*` single-field or status write → restore previous value · `cancel-*` flips a set to cancelled → restore previous statuses · `claim-*` atomic `PENDING → PROCESSING`, throws `NOT_ALLOWED` → revert to `PENDING` · `sync-*` / `recompute-*` → restore snapshot.

No compensation by design: `apply-*` runs a transition or policy leg, idempotent, skips when already applied · `request-*` outbound external call · `publish-*` emits an event.

Flag a step whose name promises different semantics than its body (a `get-*` that writes, a `validate-*` that mutates, a `find-*` that throws on empty).

## Composition body (the DAG)
The function passed to `createWorkflow` only *wires* steps; normal JS control flow silently misbehaves. Flag:
- an `async` composition function, or an arrow function — it must be a plain `function`, typed with the plain input type, not `WorkflowData<X>`
- `await` anywhere in the body
- `if`/`else` or a ternary — branching goes through sibling `when('label', { deps }, predicate).then(...)`. A `when(...)` value is `T | undefined`: read it with `?.` or `?? null`. An empty `.then(() => {})` is a deliberate no-op branch
- `for`/`while` loops — loop in the calling code or map inside `transform`
- `new Date()`, `??`, `||`, `?.`, `!!`, object spread or string concatenation in the body — wrap the computation in `transform`
- the same step invoked twice without a unique `.config({ name })` — the duplicate id fails at load
- non-serializable values in `WorkflowResponse` (Map, Set, class instances); a void workflow returns `new WorkflowResponse(void 0)`
- Body order: lock, get, validate, find/resolve, mutate, sub-workflow, link, publish event, release lock, response. Get the DTO first — validate steps take the row, not the id
- Pass `input` or a step output straight into a step when the shape already matches; use `transform({ deps }, data => ({ ...clean literal }))` only when reshaping is needed. A `transform` is pure — never `await` inside one
- Compose with `xWorkflow.runAsStep({ input })`; `parallelize(a, b)` would run independent steps and destructure results in order, but is not used in this repo — flag a new one. Extension points are `createHook('<name>', {...})` returned in `WorkflowResponse(result, { hooks })`
- Read workflows: no lock, JSDoc ending "Read-only — no compensation.", secondary reads via `useQueryGraphStep(...).config({ name })`, one final `transform` shaping the response, and a local `Raw*Row` type for loose rows

## Step anatomy
- `createStep(id, handler, compensation?)` with a stable string id; handler takes one object parameter and `{ container }`
- Return `new StepResponse(data, compensationData)`; a void step returns `new StepResponse(void 0)`
- Compensation data by write kind: the created id for an insert, the prior row (or a `buildReversibleUpdate` prior — reuse it, it is generic) for an update, a prior-rows array for a status sweep. **Flag a newly invented compensation shape**
- Every compensation starts with `if (!data) { return; }`. Compensations run in reverse order — verify each one actually reverses its own step's effect
- `createStep({ name, noCompensation: true }, ...)` when the effect is external and cannot be undone. Read-only steps omit the compensate function
- One mutation per step — a step doing several writes cannot be cleanly rolled back; split it. Write steps are idempotent (check before writing) and compensate only rows they created
- Resolve services through the module-key constant or enum, never a string literal; logger via `container.resolve<Logger>(ContainerRegistrationKeys.LOGGER)`
- **Cross-module reads happen only here**: `query.graph` via `ContainerRegistrationKeys.QUERY` with explicit `fields` and `pagination`, or `refetchEntity({ entity, idOrFilter, scope: container, fields })` for one row with link expansions. Never post-filter with JS `.filter()` to fake a DB filter
- Before writing a new step, check `steps/` and `@medusajs/medusa/core-flows` for an existing one (`useQueryGraphStep`, `createRemoteLinkStep` / `dismissRemoteLinkStep`)
- Import DTOs, enums and status sets from the module `types`, config readers from module `utils`, state questions from the state machine
- A Medusa core workflow run inside a step is its own transaction and registers no compensation in the caller: mark the step `noCompensation`
- Do not catch and swallow errors in a step — let them propagate to trigger the compensation chain

## Entity locks
Serialize writes to one aggregate with `acquireLockStep` / `releaseLockStep` from `@medusajs/core-flows` plus the static `<Entity>Lock` class in `utils/`: key `<entity>:<id>`, TTL equal to the subscriber handle timeout, a long wait profile (`stepInput`) for event/cron flows and a short one (`requestStepInput`) for HTTP flows. Lock when the workflow mutates the aggregate's state or its ledgers; do **not** lock read workflows, catalog CRUD, or a workflow that only inserts its own row. Acquire in the entry-point workflow only (`acquireLockStep` is a no-op inside `runAsStep`, which is what lets a locking workflow be composed). The lock is not reentrant — never pass `executeOnSubWorkflow: true`. Build the lock input inside a `transform` because the key needs the resolved id. When a claim step selects the row, claim first and lock after.

## Long-running process legs
`start-*` / `complete-*` / `finalize-*` flows gate idempotency on data the flow itself changes (a rolled period, a record's own status), never on the driving record's status — a verify or finalize job may flip that first. A `claim-*` step is the only eligibility gate for firing a scheduled record, and firing goes through a sub-workflow, not a direct service call. Workflows publish only lifecycle events the domain owns, through a `publish-*` step whose names come from the module's `types/event-names.ts`; transition side effects are emitted by the module service, not by workflows.

## Pitfalls tsc and eslint miss
1. An unconsumed `transform` never executes — a throwing guard belongs in a `validate-*` step; a transform-throw is valid only when a following step consumes the result
2. `when` inside `when` is a load-time TypeError — use sibling `when`s or fold the conditions into one decision step
3. Workflow inputs are proxies, which is *why* the body cannot compute: dates cross step boundaries as ISO strings
4. Never spread one `transform` result inside another — fields vanish at runtime (spreading a raw step output is fine)
5. You cannot filter a root entity by a linked module's field in `query.graph` — query from the owning side and expand the link
6. A two-link chain plus a nested `hasMany` returns empty — fetch the second hop with its own `useQueryGraphStep` keyed by ids
7. Module links come back array-or-single — normalise before reading
8. In a jsonb filter on a relation, `$or` sits outside the relation and keys match as `{ value: { vin } }`, not `'value.vin'`
9. A `select`-narrowed list result no longer types as the full DTO — select the FK columns you need and accept the narrowed type
10. `createRemoteLinkStep` is not FK-checked — verify the target exists when the id comes from outside
11. Renaming a step id changes persisted ids for in-flight executions — leave legacy ids alone

## Invocation
From a route `xWorkflow(req.scope).run({ input })`; from a subscriber or job `xWorkflow(container).run({ input })` — no `throwOnError`, no try/catch. Do not use a workflow for a simple single-service CRUD call. `workflows/<domain>/utils/` holds a helper only when two or more steps share it and it is not domain policy (policy readers stay in the module); a helper used by one step stays in that step file.
