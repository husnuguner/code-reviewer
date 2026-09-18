/**
 * The wait a server asked for, when it asked for one.
 *
 * A backoff that reads the failed attempt rather than only counting it, which
 * is the reason `IBackoff` is a chain over a context instead of a function of
 * the attempt number. When the response carries no usable instruction it
 * steps the exponential schedule underneath, so the sequence is the same
 * whether or not the server chose to speak.
 *
 * Anything unreadable, negative or absurd is ignored rather than obeyed: a
 * malformed header must not become a wait nobody chose, and `Date.parse` is
 * permissive enough to read `-5` as a year two millennia ago and turn it into
 * "retry immediately" -- the most aggressive behaviour available, from the
 * least trustworthy input.
 */

import {
  type IBackoff,
  type IBackoffFactory,
  type IRetryBackoffContext,
} from "../../lib/resilience/index";

import { isRateLimited } from "./transient-failures";

/** How long the server said to wait, in milliseconds, or `null`. */
export function serverAskedForMs(response: Response, now: number = Date.now()): number | null {
  const header = response.headers.get("retry-after");
  if (header !== null) {
    const asked = retryAfterMs(header.trim(), now);
    if (asked !== null) return asked;
  }
  // `x-ratelimit-reset` is GitHub's own, and only means anything when the
  // response was in fact a rate limit; on any other response the window it
  // names has nothing to do with when this request might succeed.
  if (!isRateLimited(response)) return null;
  const reset = response.headers.get("x-ratelimit-reset");
  return reset === null || !/^\d+$/u.test(reset.trim())
    ? null
    : Math.max(0, Number(reset.trim()) * 1000 - now);
}

/** `Retry-After`, in either spelling the HTTP specification allows. */
function retryAfterMs(trimmed: string, now: number): number | null {
  if (/^\d+$/u.test(trimmed)) return Number(trimmed) * 1000;
  // Anything that is a number at all, yet not a whole count of seconds, is
  // malformed rather than a date -- see the note at the top of this file.
  if (trimmed === "" || !Number.isNaN(Number(trimmed))) return null;
  const asDate = Date.parse(trimmed);
  // A date already past is the server saying "now", which is a real answer.
  return Number.isNaN(asDate) ? null : Math.max(0, asDate - now);
}

type ResponseContext = IRetryBackoffContext<unknown>;

export class RetryAfterBackoff implements IBackoffFactory<ResponseContext> {
  constructor(
    /** Stepped whenever the server gave no instruction of its own. */
    private readonly schedule: IBackoffFactory<ResponseContext>,
    /** The longest wait to obey, however patient the server asked us to be. */
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

  /** What the failed attempt's own response asked for, if it was a response. */
  private askedFor(context: ResponseContext): number | null {
    if (!("value" in context.result)) return null;
    const response = context.result.value;
    return response instanceof Response ? serverAskedForMs(response, this.now()) : null;
  }
}
