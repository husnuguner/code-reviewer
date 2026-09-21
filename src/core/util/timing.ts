/**
 * Wall-clock durations and model-call cost, as the logs state them.
 * @packageDocumentation
 */

import { type ChatUsage } from "../ports/chat-model";

import { formatCount } from "./text";

/** Milliseconds from an arbitrary origin; only differences are meaningful. */
export type Clock = () => number;

/** The process's monotonic clock. */
export const SYSTEM_CLOCK: Clock = () => performance.now();

/**
 * Formats milliseconds as seconds with one decimal.
 *
 * @param milliseconds - A duration; negatives read as `0`.
 * @returns e.g. `42.3s`.
 */
export function seconds(milliseconds: number): string {
  return `${(Math.max(0, milliseconds) / 1000).toFixed(1)}s`;
}

/**
 * Starts a stopwatch.
 *
 * @param now - The clock to read; injectable for tests.
 * @returns A function that returns the milliseconds elapsed since the call.
 */
export function stopwatch(now: Clock = SYSTEM_CLOCK): () => number {
  const started = now();
  return () => now() - started;
}

/**
 * Describes what one model call cost.
 *
 * @param usage - The vendor's token report, if any.
 * @param elapsedMs - The call's wall time.
 * @returns e.g. `9,445 tokens in (7,650 cached), 2,410 out, 31 tokens/s`; `""` when nothing was reported.
 * @remarks The rate tells a long answer from a slow vendor; the parenthesis is the only evidence of a cache hit.
 */
export function describeUsage(usage: ChatUsage | undefined, elapsedMs: number): string {
  if (usage === undefined) return "";
  const { inputTokens, outputTokens } = usage;
  const rate =
    outputTokens !== null && elapsedMs > 0
      ? `${formatCount(Math.round(outputTokens / (elapsedMs / 1000)))} tokens/s`
      : null;
  return [
    inputTokens === null ? null : `${formatCount(inputTokens)} tokens in${describeCache(usage)}`,
    outputTokens === null ? null : `${formatCount(outputTokens)} out`,
    rate,
  ]
    .filter((part) => part !== null)
    .join(", ");
}

/** Formats cache reads and writes: ` (7,650 cached, 120 cache written)`, or `""`. */
function describeCache(usage: ChatUsage): string {
  const read = usage.cacheReadTokens ?? 0;
  const written = usage.cacheWriteTokens ?? 0;
  const parts = [
    read > 0 ? `${formatCount(read)} cached` : null,
    written > 0 ? `${formatCount(written)} cache written` : null,
  ].filter((part) => part !== null);
  return parts.length === 0 ? "" : ` (${parts.join(", ")})`;
}
