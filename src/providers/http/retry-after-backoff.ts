/**
 * A backoff that obeys the server's `Retry-After` when given, and steps the exponential schedule otherwise.
 * Malformed, negative or absurd values are ignored rather than obeyed.
 * @packageDocumentation
 */

import {
  type IBackoff,
  type IBackoffFactory,
  type IRetryBackoffContext,
} from "../../lib/resilience/index";

import { isRateLimited } from "./transient-failures";

/**
 * How long the server said to wait.
 *
 * @param response - The failed response.
 * @param now - The current time, for a date-form header.
 * @returns Milliseconds, or `null` when no usable instruction was given. `x-ratelimit-reset` counts only
 * on a rate-limited response.
 */
export function serverAskedForMs(response: Response, now: number = Date.now()): number | null {
  const header = response.headers.get("retry-after");
  if (header !== null) {
    const asked = retryAfterMs(header.trim(), now);
    if (asked !== null) return asked;
  }
  if (!isRateLimited(response)) return null;
  const reset = response.headers.get("x-ratelimit-reset");
  return reset === null || !/^\d+$/u.test(reset.trim())
    ? null
    : Math.max(0, Number(reset.trim()) * 1000 - now);
}

/** `Retry-After` as seconds or as an HTTP date; a non-integer number is malformed, not a date. */
function retryAfterMs(trimmed: string, now: number): number | null {
  if (/^\d+$/u.test(trimmed)) return Number(trimmed) * 1000;
  if (trimmed === "" || !Number.isNaN(Number(trimmed))) return null;
  const asDate = Date.parse(trimmed);
  return Number.isNaN(asDate) ? null : Math.max(0, asDate - now);
}

type ResponseContext = IRetryBackoffContext<unknown>;

/** Wraps a schedule so a server instruction overrides the scheduled wait, capped at `maxDelayMs`. */
export class RetryAfterBackoff implements IBackoffFactory<ResponseContext> {
  constructor(
    /** Stepped whenever the server gave no instruction. */
    private readonly schedule: IBackoffFactory<ResponseContext>,
    /** The longest wait to obey. */
    private readonly maxDelayMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  next(context: ResponseContext): IBackoff<ResponseContext> {
    return this.step(this.schedule.next(context), context);
  }

  /** This wait, and the tail that follows it. */
  private step(
    scheduled: IBackoff<ResponseContext>,
    context: ResponseContext,
  ): IBackoff<ResponseContext> {
    const asked = this.askedFor(context);
    const duration = asked === null ? scheduled.duration : Math.min(asked, this.maxDelayMs);
    return {
      duration,
      next: (nextContext) => this.step(scheduled.next(nextContext), nextContext),
    };
  }

  /** What the failed attempt's response asked for, if it was a response. */
  private askedFor(context: ResponseContext): number | null {
    if (!("value" in context.result)) return null;
    const response = context.result.value;
    return response instanceof Response ? serverAskedForMs(response, this.now()) : null;
  }
}
