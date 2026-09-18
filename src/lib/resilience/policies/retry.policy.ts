/**
 * Try again, while it is worth trying and there is time to.
 *
 * Three limits, each answering a different question. `maxAttempts` bounds how
 * many times; the backoff decides how long between; `maxDuration` bounds the
 * whole sequence, because a policy that only counted attempts could spend a
 * CI job's entire budget on a host that will never answer.
 *
 * What comes out is what the operation produced -- see `unwrap`.
 */

import { ConstantBackoff, type IBackoff, type IBackoffFactory } from "../backoff";
import { PolicyError } from "../errors";
import { type Event, EventPublisher } from "../events";
import { type FailureReason, type IFailureHandler, unwrap } from "../handling";
import { type ITimer, systemTimer } from "../timing";

import { PolicyBase } from "./base.policy";
import { type IDefaultPolicyContext } from "./policy.abstraction";

/** What the retried function is told about the attempt it is making. */
export interface IRetryContext extends IDefaultPolicyContext {
  /** 1 on the first call, 2 on the first retry. */
  readonly attempt: number;
}

/** What a backoff is told when asked for the next wait. */
export interface IRetryBackoffContext<R> {
  /** The attempt that just failed, 1-based. */
  readonly attempt: number;
  /** Why it failed: what it threw, or the result that counted as a failure. */
  readonly result: FailureReason<R>;
}

export interface IRetryEvent {
  /** The attempt that failed; the one about to run is this plus one. */
  readonly attempt: number;
  readonly delayMs: number;
  readonly reason: FailureReason<unknown>;
}

export interface IGiveUpEvent {
  /** How many attempts were made in total. */
  readonly attempts: number;
  readonly reason: FailureReason<unknown>;
}

export interface IRetryOptions {
  /**
   * Total calls, **the first one included**: `3` means one call and two
   * retries, and `1` disables retrying.
   *
   * Spelled out because the other reading -- "retries after the first" --
   * differs by exactly one request, and one extra request is how a POST that
   * was already committed gets committed twice.
   */
  readonly maxAttempts: number;
  /** How long between attempts; omitted means retry immediately. */
  readonly backoff?: IBackoffFactory<IRetryBackoffContext<unknown>>;
  /**
   * Budget for the whole sequence, attempts and waits together.
   *
   * Checked *before* a wait rather than after: a wait that would end past the
   * budget is a wait nobody benefits from, so the failure surfaces at once
   * instead of a minute later.
   */
  readonly maxDuration?: number;
  /** Injected so a test can run the schedule without spending the waits. */
  readonly timer?: ITimer;
}

export class RetryPolicy extends PolicyBase<IRetryContext> {
  /** Fired before each wait, for the telemetry a silent retry cannot give. */
  readonly onRetry: Event<IRetryEvent>;
  /** Fired once, when the last attempt has failed and the answer is going out. */
  readonly onGiveUp: Event<IGiveUpEvent>;

  private readonly retries = new EventPublisher<IRetryEvent>();
  private readonly giveUps = new EventPublisher<IGiveUpEvent>();

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

  async execute<T>(
    operation: (context: IRetryContext) => PromiseLike<T> | T,
    signal?: AbortSignal | null,
  ): Promise<T> {
    const { maxAttempts, maxDuration } = this.options;
    const guard = signal ?? new AbortController().signal;
    // Read through a call, not through the property: the answer changes while
    // this loop is awaiting, and narrowing the property once would let the
    // compiler conclude the second check can never be true.
    const isAborted = (): boolean => guard.aborted;
    const started = this.timer.now();
    let backoff: IBackoffFactory<IRetryBackoffContext<unknown>> =
      this.options.backoff ?? new ConstantBackoff(0);

    for (let attempt = 1; ; attempt++) {
      const outcome = await this.runner.invoke(() => operation({ attempt, signal: guard }));
      if (outcome.kind === "success") return outcome.value;

      const { reason } = outcome;
      // A caller who cancelled is not waiting for a better answer.
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
        // The wait was cancelled; the last failure is the answer.
        return this.giveUp(attempt, reason);
      }
      // Asked again after the wait, not only before it. A cancellation that
      // lands *during* a backoff is the common one -- it is the longest part
      // of the sequence -- and a timer that resolves instead of rejecting on
      // abort would otherwise buy one more attempt nobody is waiting for.
      if (isAborted()) return this.giveUp(attempt, reason);
    }
  }

  /** Hand back what the last attempt produced, having said that we stopped. */
  private giveUp<T>(attempts: number, reason: FailureReason<T>): T {
    this.giveUps.emit({ attempts, reason });
    return unwrap(reason);
  }
}

/** A policy that retries the failures `handler` recognises. */
export function retry(handler: IFailureHandler, options: IRetryOptions): RetryPolicy {
  return new RetryPolicy(handler, options);
}
