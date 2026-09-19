/**
 * Retries while it is worth trying and there is time: `maxAttempts` bounds how many, the backoff how long
 * between, `maxDuration` the whole sequence. What comes out is what the operation produced.
 * @packageDocumentation
 */

import { ConstantBackoff, type IBackoff, type IBackoffFactory } from "../backoff";
import { PolicyError } from "../errors";
import { type Event, EventPublisher } from "../events";
import { type FailureReason, type IFailureHandler, unwrap } from "../handling";
import { type ITimer, systemTimer } from "../timing";

import { PolicyBase } from "./base.policy";
import { type IDefaultPolicyContext } from "./policy.abstraction";

/** What the retried function is told about its attempt. */
export interface IRetryContext extends IDefaultPolicyContext {
  /** `1` on the first call, `2` on the first retry. */
  readonly attempt: number;
}

/** What a backoff is told when asked for the next wait. */
export interface IRetryBackoffContext<R> {
  /** The attempt that just failed, 1-based. */
  readonly attempt: number;
  /** Why it failed. */
  readonly result: FailureReason<R>;
}

/** Fired before each wait. */
export interface IRetryEvent {
  /** The attempt that failed; the one about to run is this plus one. */
  readonly attempt: number;
  readonly delayMs: number;
  readonly reason: FailureReason<unknown>;
}

/** Fired once, when the last attempt has failed. */
export interface IGiveUpEvent {
  /** Attempts made in total. */
  readonly attempts: number;
  readonly reason: FailureReason<unknown>;
}

/** Options for {@link RetryPolicy}. */
export interface IRetryOptions {
  /** Total calls, the first included: `3` is one call and two retries; `1` disables retrying. */
  readonly maxAttempts: number;
  /** How long between attempts; omitted retries immediately. */
  readonly backoff?: IBackoffFactory<IRetryBackoffContext<unknown>>;
  /** Budget for the whole sequence, checked before each wait so a wait that would overrun is not taken. */
  readonly maxDuration?: number;
  /** Injectable so a test need not spend the waits. */
  readonly timer?: ITimer;
}

/** Retries the failures its handler recognises. */
export class RetryPolicy extends PolicyBase<IRetryContext> {
  /** Fired before each wait. */
  readonly onRetry: Event<IRetryEvent>;
  /** Fired once, when the answer is going out after the last failure. */
  readonly onGiveUp: Event<IGiveUpEvent>;

  private readonly retries = new EventPublisher<IRetryEvent>();
  private readonly giveUps = new EventPublisher<IGiveUpEvent>();

  /**
   * @throws {@link PolicyError} when `maxAttempts` is not a positive whole number.
   */
  constructor(
    handler: IFailureHandler,
    private readonly options: IRetryOptions,
  ) {
    super(handler, options.timer ?? systemTimer);
    if (!Number.isSafeInteger(options.maxAttempts) || options.maxAttempts < 1) {
      throw new PolicyError(
        `maxAttempts must be a positive whole number, got: ${String(options.maxAttempts)}`,
      );
    }
    this.onRetry = this.retries.addListener;
    this.onGiveUp = this.giveUps.addListener;
  }

  /**
   * Runs `operation`, retrying handled failures.
   *
   * @returns The first success, or the last attempt's result unwrapped (its value returned, its error thrown).
   */
  async execute<T>(
    operation: (context: IRetryContext) => PromiseLike<T> | T,
    signal?: AbortSignal | null,
  ): Promise<T> {
    const { maxAttempts, maxDuration } = this.options;
    const guard = signal ?? new AbortController().signal;
    // A call, not a narrowed property: the answer changes while the loop awaits.
    const isAborted = (): boolean => guard.aborted;
    const started = this.timer.now();
    let backoff: IBackoffFactory<IRetryBackoffContext<unknown>> =
      this.options.backoff ?? new ConstantBackoff(0);

    for (let attempt = 1; ; attempt++) {
      const outcome = await this.runner.invoke(() => operation({ attempt, signal: guard }));
      if (outcome.kind === "success") return outcome.value;

      const { reason } = outcome;
      if (attempt >= maxAttempts || isAborted()) return this.giveUp(attempt, reason);

      const next: IBackoff<IRetryBackoffContext<unknown>> = backoff.next({
        attempt,
        result: reason,
      });
      backoff = next;
      if (maxDuration !== undefined && this.timer.now() - started + next.duration >= maxDuration) {
        return this.giveUp(attempt, reason);
      }

      this.retries.emit({ attempt, delayMs: next.duration, reason });
      try {
        await this.timer.sleep(next.duration, guard);
      } catch {
        return this.giveUp(attempt, reason);
      }
      // Checked after the wait too: a cancellation during the backoff must not buy one more attempt.
      if (isAborted()) return this.giveUp(attempt, reason);
    }
  }

  /** Emits `onGiveUp` and hands back what the last attempt produced. */
  private giveUp<T>(attempts: number, reason: FailureReason<T>): T {
    this.giveUps.emit({ attempts, reason });
    return unwrap(reason);
  }
}

/** A policy that retries the failures `handler` recognises. */
export function retry(handler: IFailureHandler, options: IRetryOptions): RetryPolicy {
  return new RetryPolicy(handler, options);
}
