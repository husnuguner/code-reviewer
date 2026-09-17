---
name: medusa-module
description: Review MedusaJS 2.x module layout, module service, helper services, pure utils, state machine, and medusa-config wiring.
framework: medusa
---

## Layout
One bounded context = one full Medusa module. Split a domain into sub-modules (`src/modules/<domain>/<name>/`) only when they need different dependency sets or independent migration snapshots.

| Path | Holds |
|---|---|
| `index.ts` | `export default Module(KEY, { service, loaders? })` — nothing else |
| `<domain>-<name>-module-service.ts` | the `MedusaService` subclass, at the module root (not in `services/`) |
| `models/` | one `model.define` per file + an `index.ts` barrel |
| `types/` | `enums.ts`, `index.ts` (DTOs + barrel), `constants.ts`, `event-names.ts` |
| `utils/` | pure helpers, no container access |
| `services/` | auto-registered helper services, key = `lowerCaseFirst(ClassName)` |
| `providers/<kind>/`, `loaders/<kind>/` | provider contract, default impl, loader |
| `state-machine/` | generic engine + domain instance + barrel, only when the entity has a lifecycle |
| `migrations/` | generated only |

- Module key: a single module exports `export const <NAME>_MODULE = '<camelName>Module'` from its `index.ts`; a domain with several sub-modules centralizes keys in `src/modules/<domain>/modules.ts` as a TS enum. Keys are strings, never `Symbol.for`, and must be unique project-wide — a duplicate causes a silent container collision
- Sub-module imports run one way; flag a cycle between siblings
- `medusa-config.ts` entry with `key`, `resolve`, `definition.dependencies` (every Medusa or custom module a provider inside it injects) and `options.providers[]` when it has providers. Flag a new module missing its registration or a provider-injected module missing from `dependencies`

## Module service
- The module service extends `MedusaService<{ Model: { dto } }>({ Model })` — always supply the generic so generated CRUD returns the narrowed DTO. Never re-implement list/retrieve/create/update/delete by hand; flag a custom method duplicating a built-in (`createXs`, `retrieveX`, `listXs`, `updateXs`, `deleteXs`, `softDeleteXs`, `restoreXs`)
- Constructor takes `(container: InjectedDependencies, options?)`: a local `type InjectedDependencies`, `super(...arguments)` before anything touches `container`, `protected readonly` fields for injected dependencies, public getters where callers need them. Logger via `container.logger`
- The service holds generated CRUD, multi-model transactional writes and orchestration of injected helpers. Pure logic goes to `utils/`; cross-module access belongs to a workflow step (`medusa-conventions`) — so flag `container.resolve` inside the service and any import of another module's service
- Transactional method: `@InjectTransactionManager()` on the method, `@MedusaContext() sharedContext` as the last parameter, and `sharedContext` threaded into every CRUD call inside it — a missed thread silently escapes the transaction
- jsonb is "replace, don't merge": the generated update deep-merges plain objects, so a recomputed jsonb map must be nulled first and then written inside one transactional method
- Business outcomes return an outcome enum plus `logger.warn`; they are not thrown. Throwing belongs to utils, providers and the state machine. A side effect that must never break the main flow is swallowed with `logger.error`
- Log lines start with `[<Scope>]` through the injected `Logger` — never `console`
- No raw SQL and no direct repository access from a service — the single exception is the documented atomic-claim helper below
- Generated list calls pass `{ take, skip }` and an explicit field selection — an unbounded `listXs()` on a growing table is a bug
- **Never name a helper service `<ModelName>Service`** — the framework registers the per-model repository under that key, so a custom class shadows it and breaks `query.graph`. Any other name is fine
- A long-running claimer implements `__hooks = { onApplicationPrepareShutdown }` and forwards the signal

## Utils and helpers
- Utils are pure and never touch the container; a util needing DB access takes the module service as a parameter. Whether it ships as a static-only class or as plain functions, and how the file is named, is the author's choice
- Typed config readers follow one shape: `export type <Slot>Config` first, then `static configOf(holder)` (a `require*` variant for mandatory slots, nullable for optional), then slot arithmetic as static methods each taking one object parameter. Consumers call the slot helper, never the generic reader underneath
- Open/closed dispatch: `const HANDLERS: Record<Enum, Fn> = {...}` plus a guarded lookup that throws `MedusaError(INVALID_DATA)` on an unknown key — the `Record` type makes a missing case a compile error. An exhaustive `switch` ends with `const exhaustive: never = x;` and a throw
- jsonb list columns get a `sanitize()` (write path, cleans loose input) and `read()` (read path, `Array.isArray(v) ? v : []`) pair; `read` does not validate elements
- A lock-sensitive batch claim bypasses the ORM: inject `manager: EntityManager`, open `knex.transaction`, select with `.forUpdate().skipLocked()`, compare against `knex.fn.now()` (never `new Date()`), and flip status in the same transaction. Flag a claim that is not atomic
- Names must match what the thing is — flag a type or helper reused under a name that no longer describes it. Magic numbers and repeated literals become named constants, declared once and shared

## State machine
When the entity has a lifecycle: `state-machine/machine.ts` is the generic engine, `<entity>-machine.ts` the instance, `index.ts` the barrel. Transitions are declared per enum member with the fluent draft (`t.from(...).to(...).staysIn(...).emits(...)`) under a `Record<Transition, ...>` constraint, so a new enum member without a transition is a compile error. The machine never writes: the service applies (`resolve`, `isSelfTransition`, `systemEvents`), workflows and routes query (`can`, `terminalStatus`, `targetOf`, `staysIn`, `isTerminalStatus`). An illegal transition throws `MedusaError(NOT_ALLOWED)`; an invalid definition throws a plain `Error` at boot. **Nothing outside the machine restates a status list** — flag a duplicated status array or an inline legality check.
