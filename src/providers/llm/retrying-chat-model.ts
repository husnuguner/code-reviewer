/**
 * A `ChatModel` decorator that retries transient failures with a per-attempt timeout. The numbers are
 * operational constants, not settings; the options exist so tests can run the schedule without spending it.
 * @packageDocumentation
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
/** The first retry's backoff window; longer than the transport's because rate limits are per minute. */
export const DEFAULT_BASE_DELAY_MS = 1000;
/** The longest any single wait may be. */
export const DEFAULT_MAX_DELAY_MS = 30_000;
/** How long one completion may take; generous because a reasoning model on a large diff is slow. */
export const DEFAULT_TIMEOUT_MS = 180_000;
/** The budget for one completion including its retries. */
export const DEFAULT_MAX_DURATION_MS = 600_000;

/** Options for {@link RetryingChatModel}. */
export interface ChatRetryOptions {
  readonly attempts?: number;
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
  /** Per attempt, not per call. */
  readonly timeoutMs?: number;
  /** The whole call's budget, retries and waits together. */
  readonly maxDurationMs?: number;
  /** Where each retry is announced; omitted, retries are silent. */
  readonly logger?: Logger;
  /** Injectable so a test can pin the wait. */
  readonly random?: () => number;
  /** Injectable so a test need not spend the waits. */
  readonly timer?: ITimer;
}

/** Why an attempt is being repeated, for the log line. */
function describe(reason: IRetryEvent["reason"]): string {
  if ("value" in reason) return "was refused";
  const { error } = reason;
  if (isTimeout(error)) return "ran out of time";
  const { statusCode } = error as { statusCode?: unknown };
  return typeof statusCode === "number"
    ? `answered ${String(statusCode)}`
    : `failed (${errorMessage(error)})`;
}

/** Retries a `ChatModel` on transient failure, each attempt under its own deadline. */
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
          (attemptContext) =>
            this.inner.generate(messages, { ...options, signal: attemptContext.signal }),
          context.signal,
        ),
      options.signal,
    );
  }
}
