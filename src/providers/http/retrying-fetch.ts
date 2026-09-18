/**
 * A transport that survives a 429, wrapped around one that does not.
 *
 * `FetchLike -> FetchLike`, so a client that already works keeps working: the
 * GitHub poster's one endpoint, its origin allowlist and its error handling
 * are untouched, and the decision that "the network may fail once" is made
 * where the network enters the program rather than in the module that happens
 * to speak HTTP.
 *
 * This file composes and does not decide. The policies come from
 * `lib/resilience`, the rules from `./transient-failures`, the waiting from
 * `./retry-after-backoff`; what is left here is the wiring and the defaults.
 *
 * The composition is worth reading once:
 *
 * - A **retry policy** whose handler treats a retryable *status* as a failure.
 *   That is why there is no sentinel exception anywhere below: when the
 *   attempts run out, the policy hands the last `Response` back as a value,
 *   body unread, and the caller cannot tell a retried request from a fresh
 *   one.
 * - A **timeout policy** inside it, one per attempt, supplying the signal the
 *   transport aborts on. Per attempt rather than per call, because the call's
 *   own bound is the retry policy's `maxDuration`.
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
/** How long one attempt may take before it is abandoned. */
export const DEFAULT_TIMEOUT_MS = 30_000;

export interface HttpRetryOptions {
  readonly attempts?: number;
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
  /** The whole call's budget; not one attempt's. */
  readonly maxDurationMs?: number;
  /** Per attempt, not per call. */
  readonly timeoutMs?: number;
  /** Where each retry is announced. Omitted, they happen in silence. */
  readonly logger?: Logger;
  /** Injected so a test can pin the wait. */
  readonly random?: () => number;
  /** Injected so a test need not spend the waits. */
  readonly timer?: ITimer;
}

/**
 * Release the connection a response we are discarding would otherwise hold.
 *
 * An unread body keeps its socket checked out of the pool; a run that retried
 * twice per request would leak them steadily.
 */
async function discard(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Already consumed or already closed: either way the socket is free.
  }
}

/** Why an attempt is being repeated, for the one line that says so. */
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
 * A transport, with the transient failures answered by asking again.
 *
 * The returned function keeps the `FetchLike` contract exactly: a `URL` in, a
 * `Response` out, and the last response returned unread when the attempts run
 * out -- so a caller that reads `response.status` and `response.text()` to
 * build its own error is none the wiser, and a caller that never fails pays
 * one comparison.
 *
 * `transport`, not `fetch`: this module reaches for no global and adds no
 * destination of its own, and the `URL` it is handed was produced by the
 * caller's own origin allowlist. Naming the parameter for what it is keeps
 * the one bare `fetch` identifier in this program at the composition root,
 * where the comment explaining it lives.
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
      // Only a response we are about to throw away is released here; the one
      // that survives the last attempt is the caller's to read.
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
