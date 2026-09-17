---
name: medusa-subscriber
description: Review MedusaJS 2.x event subscribers and PubSub handlers — file shape, reliability, idempotency, skip-vs-fail semantics, and event naming.
framework: medusa
---

## File shape
- `src/subscribers/<domain>/<event-kebab>.handler.ts`. A helper file in the same folder drops the `.handler` suffix and has **no** default export and no `config`, so Medusa does not register it — flag a helper that accidentally exports either
- The registered file exports exactly three things: the handler class, `export const config: SubscriberConfig = { event }`, and `export default async function <camel>Subscriber(args)` that calls the module-level singleton's `.execute(args)`
- The handler class extends `SubscriberHandler<Payload>` and implements `protected async handle(event, _context)`
- Payload type declared locally in the handler file; share a type only when several handlers consume the same event family. An untyped `any` payload hides breaking schema changes
- Custom event names come only from enums in the owning module's `types/event-names.ts` or exported constants under `src/common/shared/custom-events` / `src/common/shared/events` — never an inline string. A Medusa core event (`order.placed`, `customer.created`) is spelled as the framework defines it; a custom event with no constant yet must at least be namespaced `module.entity.action` and should get one. `config.event` may be an array; then the handler branches on `event.event.name`

## Critical vs non-critical events
- Critical business events (payments, orders, documents, lifecycle transitions) must use the PubSub `SubscriberHandler` pattern. A plain subscriber has no retry, no dedup and no inbox tracking — flag its use on any payment / order / fulfillment path
- `pubSubModuleService.save(...)` must include `attempts` and `backoff`; missing retry config is silent data loss on failure. The transaction id must be a meaningful correlation key (e.g. the order id)
- `generateFollowUpEvents` is the only correct place to emit chained events — emitting inside `handle` bypasses the outbox

## Handler body
- The body does one thing: run **one** workflow with `event.container`, mapping payload fields explicitly. Never define a workflow in a handler file; never call a module service directly for domain work
- Idempotency, per-event locking, inbox dedupe, retry and the handle timeout belong to `SubscriberHandler.execute` — the handler never checks inbox state itself. Handler logic must still be safe to run twice (events may be delivered more than once)
- Skip vs fail: throw `MedusaError(INVALID_DATA, ...)` for an unrecoverable data problem so the delivery is marked failed; a plain `return` for a legitimate skip (feature flag off, record type out of scope, record compensated away). An intentional no-op handler is a bare `return;`
- Do not catch and swallow errors on a critical path — let them propagate for retry. A non-critical event may catch, log with `logger.error` and continue
- Override `isCorrelationContextEnabled()` to `true` and log through `CorrelationContext.log('message', { ...ids })`; reserve `logger.info` for bracket-prefixed one-liners
- When a handler family shares a preamble (feature-flag guard, record lookup, null skip, type skip, user loop with `continue`), extract the lookup into a shared helper file and keep the preamble order identical across the family
- Guard against circular event chains — A triggering B triggering A is a livelock
