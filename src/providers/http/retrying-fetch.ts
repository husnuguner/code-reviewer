/**
 * A `FetchLike` decorator that retries transient failures: a retry policy whose handler treats a
 * retryable status as a failure, with a per-attempt timeout inside it. Composes; decides nothing itself.
 * @packageDocumentation
 */

import { type Logger, NULL_LOGGER } from "../../core/ports/logger";
import { errorMessage } from "../../core/util/errors";
import {
  ExponentialBackoff,
  FailureHandler,
  type IRetryEvent,
  type ITimer,
  fullJitter,
  retry,
  timeout,
} from "../../lib/resilience/index";

import { type FetchLike } from "./fetch-like";
import { RetryAfterBackoff } from "./retry-after-backoff";
import {
  IDEMPOTENT_METHODS,
  causeCode,
  isRetryableFailure,
  isRetryableStatus,
  isTimeout,
} from "./transient-failures";

/** Total calls, the first included. */
export const DEFAULT_ATTEMPTS = 3;
/** The first retry's backoff window; each later one doubles it. */
export const DEFAULT_BASE_DELAY_MS = 500;
/** The longest any single wait may be, `Retry-After` included. */
export const DEFAULT_MAX_DELAY_MS = 20_000;
/** The budget for the whole call, retries and waits included. */
export const DEFAULT_MAX_DURATION_MS = 90_000;
/** How long one attempt may take. */
export const DEFAULT_TIMEOUT_MS = 30_000;

/** Options for {@link withRetry}. */
export interface HttpRetryOptions {
  readonly attempts?: number;
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
  /** The whole call's budget. */
  readonly maxDurationMs?: number;
  /** Per attempt, not per call. */
  readonly timeoutMs?: number;
  /** Where each retry is announced; omitted, retries are silent. */
  readonly logger?: Logger;
  /** Injectable so a test can pin the wait. */
  readonly random?: () => number;
  /** Injectable so a test need not spend the waits. */
  readonly timer?: ITimer;
}

/** Releases the socket a discarded response would otherwise hold. */
async function discard(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Already consumed or closed.
  }
}

/** Why an attempt is being repeated, for the log line. */
function describe(reason: IRetryEvent["reason"]): string {
  if ("value" in reason) {
    return reason.value instanceof Response
      ? `answered ${String(reason.value.status)}`
      : "was refused";
  }
  const { error } = reason;
  return isTimeout(error) ? "timed out" : `failed (${causeCode(error) ?? errorMessage(error)})`;
}

/**
 * Wraps a transport so transient failures are retried.
 *
 * @param transport - The underlying `fetch`; named for what it is, since this adds no destination.
 * @returns A `FetchLike` that keeps the contract exactly: when attempts run out, the last response is
 * returned unread, so a caller cannot tell a retried request from a fresh one.
 */
export function withRetry(transport: FetchLike, options: HttpRetryOptions = {}): FetchLike {
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const log = (options.logger ?? NULL_LOGGER).child("http");
  const perAttempt = timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  const schedule = new ExponentialBackoff({
    initialDelay: options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS,
    maxDelay: maxDelayMs,
    generator: fullJitter,
    ...(options.random !== undefined && { random: options.random }),
  });

  return async (input: URL, init: RequestInit): Promise<Response> => {
    const method = (init.method ?? "GET").toUpperCase();
    const isIdempotent = IDEMPOTENT_METHODS.has(method);

    const policy = retry(
      FailureHandler.whenResult(
        (value) => value instanceof Response && isRetryableStatus(value, isIdempotent),
      ).orWhen((error) => isRetryableFailure(error, isIdempotent)),
      {
        maxAttempts: options.attempts ?? DEFAULT_ATTEMPTS,
        backoff: new RetryAfterBackoff(schedule, maxDelayMs),
        maxDuration: options.maxDurationMs ?? DEFAULT_MAX_DURATION_MS,
        ...(options.timer !== undefined && { timer: options.timer }),
      },
    );

    policy.onRetry(({ attempt, delayMs, reason }) => {
      // Only a response about to be thrown away is released; the last one is the caller's to read.
      if ("value" in reason && reason.value instanceof Response) void discard(reason.value);
      log.warn(
        `${method} ${input.pathname} ${describe(reason)}; retrying in ${String(delayMs)}ms ` +
          `(attempt ${String(attempt + 1)} of ${String(options.attempts ?? DEFAULT_ATTEMPTS)}).`,
      );
    });

    return policy.execute(
      (context) =>
        perAttempt.execute(
          (attemptContext) => transport(input, { ...init, signal: attemptContext.signal }),
          context.signal,
        ),
      init.signal,
    );
  };
}
