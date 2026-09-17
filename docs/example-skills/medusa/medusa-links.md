---
name: medusa-links
description: Review MedusaJS 2.x module link definitions for file layout, cascade/filterable/isList options, ordering, and lifecycle management.
framework: medusa
---

## Link definition
- One link per file under `src/links/` — never export an array of several links from one file
- `defineLink(ModuleA.linkable.modelA, ModuleB.linkable.modelB)`; the custom module comes first. Never add `.linkable()` to the model itself — that surface is auto-generated
- `deleteCascade: false` explicitly on both sides unless a cascade is genuinely intended
- Explicit `filterable: [...]` on both sides for the fields queried through `query.index()` (also requires the Index Module installed/configured); without it cross-module field filtering silently returns wrong or empty results
- `isList: true` only on the "many" side
- An explicit `database: { table: '...' }` rather than relying on the generated name
- Cross-module data is a link, never a foreign key column on the model

## Order & migration
- Module order in `createRemoteLinkStep`, `dismissRemoteLinkStep` and `link.create()` / `link.dismiss()` MUST match the order in `defineLink()` — a mismatch is a silent runtime failure, not a type error
- A new or changed link needs `npx medusa db:migrate` (run by the user) before the link is used in code

## Managing links
- Inside a workflow composition use the built-in `createRemoteLinkStep` / `dismissRemoteLinkStep` — never hand-roll a link step. A conditional link is an array spread inside the `transform`, not a second `when`
- Outside composition (step body, route, job) use `link.create()` / `link.dismiss()` resolved via `ContainerRegistrationKeys.LINK`
- A link created in a workflow needs its dismissal as compensation, or it leaks on rollback
- `createRemoteLinkStep` is not FK-checked: when an id comes from outside, a `validate-*` step must verify the target exists
- Links come back from a query as array-or-single — normalise before reading. A two-link chain plus a nested `hasMany` returns empty; fetch the second hop with its own query keyed by ids
