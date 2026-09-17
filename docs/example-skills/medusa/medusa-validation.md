---
name: medusa-validation
description: Review MedusaJS 2.x Zod validation schemas, list params/configs, and the middleware registry entries that bind them to routes.
framework: medusa
---

## Schema file layout
- One `validation-schemas.ts` beside `route.ts` per resource folder; it also holds the sub-resource list schemas and child routes import upward. A leaf action folder gets its own file only when its body differs
- Every mutating route (POST, DELETE with a body) must have a schema here and a matching `validateAndTransformBody(schema)` entry in the middleware registry — flag a mutation with no schema
- What a resource file is expected to contain — the pieces, **not** their spelling: a body schema per mutation with its inferred type, list params built on `createFindParams`, a default-fields array, and a retrieve config plus a list config derived from it by spread. The house shapes are `<Verb><Entity>Schema` / `<Verb><Entity>Body`, `AdminGet<Entities>Params` / `AdminGet<Entities>Query`, `default<Entity>Fields`, `retrieve<Entity>Config`, `list<Entities>Config` on admin and `<Thing>Body` / `<Thing>Query` on store — but a differently spelled or cased identifier is **not** a finding. Flag only a missing piece (no list config, a list config not derived from the retrieve one, a mutation with no schema)
- The Zod schema must match the generic on `AuthenticatedMedusaRequest<T>` — flag a drift between them

## Field rules
- Enums via `z.nativeEnum(<ModuleEnum>)` imported from the owning module's `types` barrel — never a re-declared string union
- Codes get a regex (exported as a constant when the UI reuses it); ids are `z.string().min(1)` only
- Required free text is `z.string().trim().min(1)`. No `.max()` on text — the columns are unbounded `text`; add a bound only when a DB or external constraint exists
- Update fields `.optional()`, clearable fields `.nullable().optional()`, server defaults `.default()`. Never `.strict()`. Coerce numbers with `z.coerce.number()`
- `.refine` for array uniqueness (the API mirror of a DB unique); `.superRefine` with `ctx.addIssue({ code: z.ZodIssueCode.custom, message, path })` for cross-field checks
- A virtual query param (not a column) is coerced with `.transform()` in the schema and deleted from `filters` in the route before `query.graph`
- A body-less action route still gets `z.object({})` so the registry stays uniform
- Field arrays use dotted relation and link paths (`'order.display_id'`)

## List params and configs
- `createFindParams({ offset: 0, limit, order: '-created_at' }).merge(z.object({...}))` from `@medusajs/medusa/api/utils/validators`; merge `q` explicitly. Limit 50 for catalog entities, 20 for ledgers. Use the natural-sequence order where one exists (`'-no'`, `'-version'`)
- `allowedFilterableFields` on every list config whose params merge filters that reach `query.graph` — flag a filter that can never take effect because it is missing
- A detail GET reuses the list params with `retrieve<Entity>Config`; with no filters, `createFindParams()` and `{ isList: false }`. A per-parent sub-list reuses the global schema and config and pins the parent id in the route
- Store configs are bare `{ isList }` — the workflow decides fields. A store route declares a query schema even when unread: `validateAndTransformQuery` is what fills `req.filterableFields` for the pricing-context middleware

## Middleware registry
- Admin: one `middlewares.ts` per feature exporting `<feature>Middlewares: CustomRouteConfig[]` (type from `src/api/utils/types.ts`), spread into the root `src/api/middlewares.ts`. One entry per method + matcher: GET gets `validateAndTransformQuery(Params, config)`, POST gets `validateAndTransformBody(Schema)`
- `validateAndTransformBody` / `validateAndTransformQuery` come from `@medusajs/framework`
- Matcher params mirror the folder names: `[id]` at the first level, `[<entity>Id]` deeper. Flag a matcher that does not match its route folder
- Middleware order: `authenticate` first, then the validator, then `setPricingContext.middleware` on store entries — never nested inside one another. Public catalog routes omit `authenticate`
- No custom middleware for locks or actors: locks live in workflows, admin auth is global
