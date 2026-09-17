---
name: medusa-route
description: Review MedusaJS 2.x API route files — handler shape, input sources, workflow-for-writes, reads, status codes, response envelope, and errors.
framework: medusa
---

## Handler shape
- `export const GET | POST | DELETE` arrow functions; updates are POST to `/:id` (the no-`PUT`/`PATCH` rule itself lives in `medusa-conventions`). `DELETE` is soft delete only, paired with a POST `/restore`
- `req` is `AuthenticatedMedusaRequest<Body, Query>` on every admin route and every authenticated store route; bare `MedusaRequest` only on a public store route. Body type in the first generic slot, query type in the second (`<unknown, XQuery>` admin, `<never, XQuery>` store). Response is `MedusaResponse` — never plain `Request`/`Response`
- Read input only from `req.validatedBody`, `req.validatedQuery`, `req.filterableFields`, `req.queryConfig`, `req.params`. **Never `req.body` or `req.query`**
- Resolve through `req.scope.resolve(...)`: Query via `ContainerRegistrationKeys.QUERY`, module services via the module-key constant with the generic form
- No dynamic `await import(...)` in the handler body; no try/catch (the global error handler exists and a bare catch swallows errors); if an exceptional route genuinely must catch, it re-throws wrapped in `MedusaError`; no defensive `?.` on data the framework guarantees; no destructuring of a value used once
- Tiny pure helpers are `const` arrows above the handler. Read-shaping helpers shared by two or more routes go to `src/api/<surface>/<feature>/utils/`; anything that writes or encodes a business rule goes to a workflow or a module helper
- Keep routes thin: complex business logic belongs in a workflow, not the handler

## Writes go through a workflow
- `const { result } = await xWorkflow(req.scope).run({ input })` — no `throwOnError`, no try/catch; errors propagate to Medusa's handler. A route mutating through a module service directly is a layering violation
- Map the body to workflow input field by field; spread `{ id, ...req.validatedBody }` only when the schema *is* the workflow input
- Server-set fields (`source`, `created_by`) are pinned at the route so one workflow can serve both admin and store
- State legality is validated inside the workflow, not the route. A business refusal raised in the route uses `NOT_ALLOWED` with a sentence saying who may do it

## Reads
- Plain reads use `query.graph` in the route; a `get-*` workflow only when the payload is stitched from several modules
- Always an explicit `fields` array (or `req.queryConfig.fields`) — never `fields: ['*']` on a collection. When the route uses `req.queryConfig`, do not also set an explicit `fields`; the two conflict and break typing
- List queries always carry a `pagination` block (`req.queryConfig.pagination` or `skip`/`take`) — an unbounded list is a bug
- Always add `deleted_at: null` to filters on custom-module reads (`withDeleted: true` + `deleted_at: { $ne: null }` for a restore view)
- After a detail read, `data?.[0]` then `NOT_FOUND` when falsy; a module `retrieve*` call needs no such check. Prefer `throwIfKeyNotFound: true` over a manual existence check
- `refetchEntity` for a single-entity lookup, `query.graph` for lists or complex filters. Request only the relation depth actually used
- To filter by a field of a model in a **different** module use `query.index()`; filtering such a field via `query.graph` silently returns wrong or empty results. Never post-filter results with JS `.filter()` to fake a DB filter
- When the route derives a value from columns the client may not have requested, force them into `fields` (`[...fields, ...required.filter(f => !fields.includes(f))]`)
- A route may pre-read for ownership or scoping and post-read for the response; the state change itself stays in the workflow (actor and ownership rules: `medusa-auth`)
- A per-parent ledger GET (`/<parents>/:id/<ledger>`) filters by the parent id and returns an empty page for an unknown parent; it does not pre-read the parent. Only writes and detail reads answer `NOT_FOUND`

## Status codes and envelope
- `201` for any POST that creates a row (collection or sub-resource), `200` for everything else returning a body, `res.sendStatus(202)` for fire-and-forget. A sibling returning `200` on create is a deviation — copy its shape, not its status
- Detail response = a single entity key. List = a collection key plus `count`, `offset`, `limit` taken from `metadata.count/skip/take` — flag a missing envelope field, never a key's spelling. An action POST returns `{ result }` or `{ success: true }`. Delete returns `{ id, object: '<table>', deleted: true }`. Store reads return the workflow result bare
- No extra timestamps, no echoed input, no debug fields in the response

## Errors
- Which `MedusaError` code to pick and how to word it: `medusa-conventions`. Their HTTP mapping at the route boundary is `NOT_FOUND` 404, `INVALID_DATA` 400, `UNAUTHORIZED` 401, `NOT_ALLOWED` 403, `CONFLICT` 409, `INVALID_STATE` 422 — flag a handler that hand-sets a status instead of throwing

## Validation (schema file itself: `medusa-validation`)
- Every mutating route (POST, DELETE with a body) must have a Zod schema in the neighbouring `validation-schemas.ts` **and** a matching `validateAndTransformBody(schema)` entry in the feature's middleware registry — flag a new mutating route missing either half
- A GET with filters or pagination needs a `validateAndTransformQuery(Params, config)` entry, otherwise `req.queryConfig` / `req.filterableFields` arrive empty
- The Zod schema must match the typed generic on `AuthenticatedMedusaRequest<T>`

## Canonical shapes to compare a new route against
Admin list + create `src/api/admin/subscription/rules/route.ts` · admin detail + update `rules/[id]/route.ts` · admin action with no body `subscriptions/[id]/scheduled-actions/[actionId]/publish/route.ts` · admin action with body + actor `subscriptions/[id]/adjustments/route.ts` (it returns 200 on create — 201 is the intended shape) · admin sub-resource ledger list: the GET in that same file · store authenticated read `src/api/store/subscriptions/route.ts`. **Outlier, not a template:** `src/api/store/subscription/package/[packageId]/plan/[planId]/subscribe/route.ts` (try/catch, absolute imports, legacy checkout) — flag a new route that copies it.

## Paths
Nouns nested by ownership (`packages/[id]/plans/[planId]`), trailing POST verbs for actions (`/cancel`, `/publish`, `/retry`), singular feature namespace (`/admin/<feature>/...`). A global list sits at the feature root with a per-parent twin under `/<parents>/:id/<same-noun>` sharing schema and config. Operator-only interventions live under `/admin/<feature>/operations/...`.
