---
name: medusa-model
description: Review MedusaJS 2.x DML models, relation-vs-pointer choice, indexes, enums, DTO triplets, and migration safety.
framework: medusa
---

## Model file
- One model per file, `export default` the defined model — a missing default export breaks module service auto-CRUD. (House shape, not a finding: file name = table name with dashes, table name singular snake_case with the domain prefix.)
- Must use `model.define('snake_case_name', { ... })` from `@medusajs/framework/utils` — never `@Entity` decorators (MikroORM style)
- `id` first: `model.id({ prefix: 'xxx' }).primaryKey()` — every model carries a prefix, and no manual UUID fields. The prefix string itself is the author's choice; never flag its wording
- Never hand-define `created_at`, `updated_at` or `deleted_at` — Medusa adds them and they are indexable as they are; declaring them is a bug
- Never add `.linkable()` to a model — the linkable surface is auto-generated; links reference `Module.linkable.x`
- Enum columns are `model.enum(TsEnum)` with the enum imported from `../types`; status-like columns always carry `.default(Enum.X)`. No string-literal unions on a model. A free-text discriminator is allowed only when the value set is consumer-defined
- Actor columns are `created_by` / `updated_by`, nullable text, holding what `RequestContextHelper.getActor(req)` returns (an email, an actor id, or `'system'`). A spec's `author_id` / `user_id` / "who did it" field **is** `created_by` — flag a second invented actor column name. `created_by` on every row a human writes, `updated_by` only when the row has an update path; system-written ledger rows (transitions, attempts, scheduled records) carry neither
- `metadata: model.json().nullable()` on entities carrying caller-supplied or external context (aggregate roots, rows created from an API body). System-written ledger rows omit it

## Relation or plain pointer
| Situation | Correct shape |
|---|---|
| Bounded child set the ORM should auto-join | `hasMany(() => Child, { mappedBy: 'parent' })` (`hasOne` for a single child) on the parent + `belongsTo(() => Parent, { mappedBy: 'children' })` on the child |
| Navigation needed one way only | `belongsTo` with no inverse |
| Two references to the same model | role-named `belongsTo`s (`reason_period`, `applied_period`) |
| Unbounded ledger (periods, transitions, attempts, notes, logs, alerts) | plain `<entity>_id: model.text()` + explicit index — **never** `hasMany` on the parent |
| Circular reference (A points at current B, B belongs to A) | plain pointers on both sides; a workflow resolves the object on read, and one side must be nulled before the other row is deleted (flag a delete path with no such guard) |
| Data in another module | a link in `src/links/`, never an FK |

`mappedBy` must match the property name on the other side; `manyToMany` needs `mappedBy` on both sides.

## Field types
- Money / high-precision values use `model.bigNumber()`; plain `number` loses precision
- Prices are stored as-is (`49.99` → `49.99`) — flag any ×100 on save or ÷100 on display
- `.nullable()` only when the column is genuinely optional at DB level; `.default('now')` only on `model.dateTime()`
- `.unique().searchable()` on catalog natural keys (`code`, `name`) so `q` search works

## Indexes
- `.indexes([...])` chained after `define`; `.index()` only for a single-column simple index
- Index every plain pointer. Composite unique for natural keys (`['subscription_id', 'no']`, `['entity', 'key', 'kind']`). A newest-first per-parent ledger gets `{ on: ['<parent>_id', 'created_at'] }`
- Partial `where` for sparse lookups (`parent_id IS NOT NULL`) and for soft-delete-aware uniqueness (`deleted_at IS NULL`) — a unique constraint on a non-id field without the `deleted_at IS NULL` guard blocks soft-delete re-use
- Omit `name`; Medusa generates `IDX_<table>_<cols>`
- Partial unique indexes are invisible to `query.graph` filters — pair one with a `validate-*` step when the app must see the collision
- Composite `on` order decides the query plan; review it against the actual query patterns

## Types
- Enums live in `types/enums.ts` and are imported by the model, never declared in the model file. Their identifier and value spelling is the author's choice
- Status groupings live next to the enum they group (`export const ACTIVE_STATUSES: Status[] = [...]`)
- DTO triplet per model in `types/index.ts`, derived — never hand-duplicated field lists:
  `XDto = InferTypeOf<typeof X>` (`InferTypeOf` from `@medusajs/framework/types`); `CreateXDto = Partial<Omit<XDto, 'id' | <relations> | Timestamps>> & { <relation>_id?: string }`; `UpdateXDto = CreateXDto & { id: string }`. Relations are omitted from `Create` and replaced by `<relation>_id?: string`; `Timestamps` is a file-local `'created_at' | 'updated_at' | 'deleted_at'`
- JSON columns stay untyped on the model and are narrowed in the DTO: `Omit<InferTypeOf<typeof X>, 'payload'> & { payload: PayloadShape | null }`
- `types/index.ts` is the barrel: DTOs inline, then `export * from './enums'` and friends. Well-known string keys are `export const UPPER_SNAKE = 'value'` in `types/constants.ts`. Event names live in a leaf `types/event-names.ts` that imports nothing, with dotted values (`'<domain>.plugin.<event>'`)
- jsonb config validation is Zod in `types/<thing>-config.ts`; types come from `z.infer`
- `interface` only for provider contracts and their context shapes; everything else is `type`

## Registration
Two places only — `models/index.ts` (`export { default as X } from './x';`) and the module service (`X: { dto: XDto }` in the `MedusaService<{...}>` generic plus `X` in the models object). The module `index.ts` carries no model list. Flag a new model missing either.

## Migration safety
- A model diff must be accompanied by a "migration required" note; the flow is `npx medusa db:generate <module>` then `npx medusa db:migrate`, both run by the user
