/**
 * Wall-clock time, as the logs state it.
 *
 * A review's cost is almost entirely waiting -- on the model, twice per file
 * with findings -- and a log that names what was decided but not how long it
 * took cannot say *where* a slow run went. These few lines are what lets a
 * step report its duration, and lets a test pin the clock so that the line
 * it asserts on is the same on every machine.
 */

import { type ChatUsage } from "../ports/chat-model";

/** Milliseconds from an arbitrary origin; only differences are meaningful. */
export type Clock = () => number;

/** The process's monotonic clock, unaffected by a wall-clock adjustment mid-run. */
export const SYSTEM_CLOCK: Clock = () => performance.now();

/** Milliseconds as seconds with one decimal, the way a person reads a wait: `42.3s`. */
export function seconds(milliseconds: number): string {
  return `${(Math.max(0, milliseconds) / 1000).toFixed(1)}s`;
}

/**
 * A running clock: call it to read how long since it was started.
 *
 * ```ts
 * const elapsed = stopwatch(now);
 * await work();
 * log.info(`done in ${seconds(elapsed())}`);
 * ```
 */
export function stopwatch(now: Clock = SYSTEM_CLOCK): () => number {
  const started = now();
  return () => now() - started;
}

/** `7036` as `7,036`: a token count is read at a glance or not at all. */
function count(n: number): string {
  return n.toLocaleString("en-US");
}

/**
 * What one model call cost, for the log:
 * `9,445 tokens in (7,650 cached), 2,410 out, 31 tokens/s`.
 *
 * The rate is the diagnosis. A completion's wall time is almost entirely
 * output generation, so a slow call is either a long answer at the vendor's
 * usual speed -- the reviewer's own doing, and fixable by asking for less --
 * or a short answer at a slow one, which is the vendor's. Without the rate
 * the two look the same.
 *
 * The parenthesis is the proof. A prefix the vendor kept is invisible in the
 * answer and in the wall time; only this number says the run paid a tenth
 * for it (`cached`) or a quarter more to have it kept (`cache written`).
 * Left out when neither happened, so a vendor without caching reads as
 * before. Returns `""` when the vendor reported nothing at all.
 */
export function describeUsage(usage: ChatUsage | undefined, elapsedMs: number): string {
  if (usage === undefined) return "";
  const { inputTokens, outputTokens } = usage;
  const rate =
    outputTokens !== null && elapsedMs > 0
      ? `${count(Math.round(outputTokens / (elapsedMs / 1000)))} tokens/s`
      : null;
  return [
    inputTokens === null ? null : `${count(inputTokens)} tokens in${describeCache(usage)}`,
    outputTokens === null ? null : `${count(outputTokens)} out`,
    rate,
  ]
    .filter((part) => part !== null)
    .join(", ");
}

/** ` (7,650 cached, 120 cache written)`, or `""` when no prefix was kept or reused. */
function describeCache(usage: ChatUsage): string {
  const read = usage.cacheReadTokens ?? 0;
  const written = usage.cacheWriteTokens ?? 0;
  const parts = [
    read > 0 ? `${count(read)} cached` : null,
    written > 0 ? `${count(written)} cache written` : null,
  ].filter((part) => part !== null);
  return parts.length === 0 ? "" : ` (${parts.join(", ")})`;
}
