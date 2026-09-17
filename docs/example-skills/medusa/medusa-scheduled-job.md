---
name: medusa-scheduled-job
description: Review MedusaJS 2.x scheduled jobs — file and config shape, schedule source, tuning constants, batching, alerting, and error handling.
framework: medusa
---

## Shape
- A job file under `src/jobs/` exports `const config = { name, schedule }` and a `default async function (container: MedusaContainer)` — Medusa loads it by that shape
- `config.name` must be **unique project-wide** — a duplicate causes a silent job collision. Its wording is the author's choice
- `schedule` comes from the `CronSchedule` enum (`src/common/cron-schedule-enum.ts`) or a config-driven helper such as `minutesToCron(...)` — flag a raw cron string literal
- A minutely or sub-minute schedule is normal here, but it only holds with a single-flight lock and a runtime well under the interval — flag a tight poll without one. Avoid `CronSchedule.EVERY_SECOND` outright: it starves the BullMQ repeat chain
- Resolve services once at the top with the generic form (`container.resolve<XService>(XModules.CORE)`). Private `function` helpers with JSDoc sit below the default export
- Tuning knobs (log prefix, batch size, iteration ceiling, lock key, run deadline, lock expiry) are named module-level constants, not inline literals

## Concurrency and duration
- Heavy or long-running work belongs on an off-peak schedule rather than a tight poll interval
- Job runtime must stay shorter than its schedule interval. A poller that can overrun needs a single-flight lock (`{ key, onContention: 'skip', expire }`); a reconciler that must run waits instead (`{ key, timeout }`)
- A run deadline is a safety ceiling that keeps the run shorter than the lock's life — it is not a work limiter
- A handler that can hang (an external call with no timeout) starves the shared cron workers: it needs a deadline or a circuit breaker before it is scheduled

## Data processing
- Large datasets are processed in batches (a `BATCH` / `BATCH_SIZE` constant, typically 50–200) with an iteration ceiling; an unbounded `fetchAll()` into memory is a bug
- A claim that gates work must be atomic (`FOR UPDATE SKIP LOCKED` inside a module helper service) — flag a non-atomic "select then update" claim, it double-processes under two workers
- A failed item is reverted at the end of the run so it retries on the next run, not in a loop inside this one
- Reads for comparison use `query.graph` with `pagination` (`skip`/`take`) and explicit `fields`
- Very large external datasets stream through an async generator rather than loading all records at once

## Workflows and errors
- Multi-step operations needing rollback run through a workflow (`xWorkflow(container).run(...)`); a direct service call is fine for a simple single-step job
- Critical jobs let errors propagate — the scheduler logs and marks the run failed. A non-critical cleanup job may catch, log with `logger.warn` and continue
- External API calls need retry (fixed or exponential backoff); a bare `await fetch(...)` with no retry is fragile
- Surface anything a human must see with `logger.warn` / `logger.error` prefixed by `LOG_PREFIX`. Where the domain has an alert module, also raise an alert with `source: config.name` and a `context` object of ids

## Logging
Log start, per-batch progress and completion with counts — a silent job is unmonitorable.
