/**
 * A model that survives a rate limit, wrapped around one that does not.
 *
 * `ChatModel -> ChatModel`, the same shape the transport uses
 * (`providers/http/retrying-fetch`), and for the same reason: the adapter under
 * it makes one call and this decides what a failed call means. Neither the
 * vendor adapters nor the review layer change, and a test can leave the
 * decorator off entirely.
 *
 * **Not configuration.** How many times to try a model is an operational
 * property of this program, not a dial an operator turns per project: the
 * numbers below are the answer, and the constructor options exist so a test
 * can run the schedule without spending it. An environment variable for each
 * would be four more things to document, validate and get wrong, in exchange
 * for a choice nobody has needed to make.
 *
 * The timeout is the part that was missing rather than merely invisible. A
 * completion had no deadline at all, so a vendor that accepted the connection
 * and never answered would hold a concurrency slot -- one of very few -- for
 * the rest of the run, and the file it was reviewing would never be reported
 * either way.
 */

import {
  type ChatCallOptions,
  type ChatMessage,
  type ChatModel,
  type ChatResponse,
} from "../../core/ports/chat-model";
import { type Logger, NULL_LOGGER } from "../../core/ports/logger";
import { errorMessage } from "../../core/util/errors";
import {
  ExponentialBackoff,
  FailureHandler,
  type IRetryEvent,
  type ITimer,
  type RetryPolicy,
  type TimeoutPolicy,
  fullJitter,
  retry,
  timeout,
} from "../../lib/resilience/index";
import { isTimeout } from "../http/transient-failures";

import { isRetryableModelFailure } from "./transient-failures";

/** Total calls, the first included. */
export const DEFAULT_ATTEMPTS = 3;
/**
 * The first retry's backoff window.
 *
 * Longer than the transport's: a vendor's rate limit is counted per minute,
 * so coming back in half a second only spends another unit of the quota that
 * was just refused.
 */
export const DEFAULT_BASE_DELAY_MS = 1000;
/** The longest any single wait may be. */
export const DEFAULT_MAX_DELAY_MS = 30_000;
/**
 * How long one completion may take.
 *
 * Generous on purpose: a reasoning model reading a large diff is slow, and a
 * deadline that fires on a call that would have answered costs the file's
 * findings *and* pays for them twice.
 */
export const DEFAULT_TIMEOUT_MS = 180_000;
/** The budget for one completion including its retries. */
export const DEFAULT_MAX_DURATION_MS = 600_000;

export interface ChatRetryOptions {
  readonly attempts?: number;
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
  /** Per attempt, not per call. */
  readonly timeoutMs?: number;
  /** The whole call's budget, retries and waits together. */
  readonly maxDurationMs?: number;
  /** Where each retry is announced. Omitted, they happen in silence. */
  readonly logger?: Logger;
  /** Injected so a test can pin the wait. */
  readonly random?: () => number;
  /** Injected so a test need not spend the waits. */
  readonly timer?: ITimer;
}

/** Why an attempt is being repeated, for the one line that says so. */
function describe(reason: IRetryEvent["reason"]): string {
  if ("value" in reason) return "was refused";
  const { error } = reason;
  if (isTimeout(error)) return "ran out of time";
  const { statusCode } = error as { statusCode?: unknown };
  return typeof statusCode === "number"
    ? `answered ${String(statusCode)}`
    : `failed (${errorMessage(error)})`;
}

export class RetryingChatModel implements ChatModel {
  private readonly policy: RetryPolicy;
  private readonly perAttempt: TimeoutPolicy;

  constructor(
    private readonly inner: ChatModel,
    options: ChatRetryOptions = {},
  ) {
    const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
    const log = (options.logger ?? NULL_LOGGER).child("llm");
    this.perAttempt = timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    this.policy = retry(FailureHandler.when(isRetryableModelFailure), {
      maxAttempts: attempts,
      backoff: new ExponentialBackoff({
        initialDelay: options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS,
        maxDelay: options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS,
        generator: fullJitter,
        ...(options.random !== undefined && { random: options.random }),
      }),
      maxDuration: options.maxDurationMs ?? DEFAULT_MAX_DURATION_MS,
      ...(options.timer !== undefined && { timer: options.timer }),
    });
    this.policy.onRetry(({ attempt, delayMs, reason }) => {
      log.warn(
        `The model ${describe(reason)}; retrying in ${String(delayMs)}ms ` +
          `(attempt ${String(attempt + 1)} of ${String(attempts)}).`,
      );
    });
  }

  generate(messages: readonly ChatMessage[], options: ChatCallOptions = {}): Promise<ChatResponse> {
    return this.policy.execute(
      (context) =>
        this.perAttempt.execute(
          (attemptContext) => this.inner.generate(messages, { signal: attemptContext.signal }),
          context.signal,
        ),
      options.signal,
    );
  }
}
