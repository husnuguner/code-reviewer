---
name: medusa-auth
description: Review MedusaJS 2.x route authentication, actor identity, and ownership handling for security correctness.
framework: medusa
---

## Actor identity (security-critical)
- **Never** accept a user/customer id from the request body, params or query — a body-supplied identity is spoofable and a real authorization bug
- **Admin routes** take the actor from `RequestContextHelper.getActor(req)` and pass it into the workflow as `actor`, `created_by` or `updated_by`. Flag any admin route reading `req.auth_context` directly
- **Store routes** read `req.auth_context?.actor_id`, throw `MedusaError(UNAUTHORIZED)` when it is missing, and enforce ownership by filtering on `customer_id`
- An ownership miss answers `NOT_FOUND`, never 403 — a 403 leaks that the row exists. Same for scoping a child id to its parent path: read the FK and answer `NOT_FOUND` on mismatch
- Ownership that depends on business state is validated inside a workflow step, not in the handler
- Do not hand-roll an `if (!req.auth_context?.actor_id)` gate to decide whether the caller is authenticated — the `authenticate` middleware already enforces that, so the manual gate is dead duplicate logic

## Protecting routes
- Protected handlers use `AuthenticatedMedusaRequest`, never plain `MedusaRequest`
- `/admin/*` and `/store/customers/me/*` are auto-protected — a redundant `authenticate` middleware on them is a bug. Admin auth is global; never add a per-route admin auth middleware
- Any other custom route that needs protection registers `authenticate` in the feature's middleware registry, never inside the handler body
- On a store entry `authenticate('customer', ['bearer', 'session'])` comes first in the array; public catalog routes omit it entirely (full entry ordering: `medusa-validation`)

## Actor types & methods
- Admin authentication uses actor type `"user"`, customer authentication `"customer"` — flag a mismatch
- Admin routes may accept `["session", "bearer", "api-key"]`; customer routes accept only `["session", "bearer"]` — `api-key` on a customer route is wrong
- Optional auth is `{ allowUnauthenticated: true }`; then `req.auth_context?.actor_id` may be undefined and the handler must cope with that explicitly

## Data exposure
- No secrets or PII in code, logs or persisted JSON — check context/log bags that end up rendered in the admin UI
- A response returns only the entity's own fields; no echoed credentials, tokens or internal actor metadata
