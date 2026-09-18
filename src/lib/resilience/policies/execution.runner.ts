/**
 * One attempt, judged.
 *
 * Every policy runs the caller's function through this, so "did it fail" is
 * answered in one place and the success/failure events every policy publishes
 * are emitted from one place too. What it adds to a bare call is exactly
 * three things: the handler's verdict, the duration, and the guarantee that
 * an error nobody claimed leaves as it arrived.
 */

import { type Event, EventPublisher } from "../events";
import {
  type ExecutionOutcome,
  type IFailureEvent,
  type IFailureHandler,
  type ISuccessEvent,
} from "../handling";
import { type ITimer } from "../timing";

export class ExecutionRunner {
  readonly onSuccess: Event<ISuccessEvent>;
  readonly onFailure: Event<IFailureEvent>;

  private readonly successes = new EventPublisher<ISuccessEvent>();
  private readonly failures = new EventPublisher<IFailureEvent>();

  constructor(
    private readonly handler: IFailureHandler,
    private readonly timer: ITimer,
  ) {
    this.onSuccess = this.successes.addListener;
    this.onFailure = this.failures.addListener;
  }

  /**
   * Run `fn` once.
   *
   * Returns what happened when the handler recognises it; **rethrows anything
   * it does not**. That asymmetry is the point: a policy's loop can only act
   * on outcomes it is handed, so an error the caller never asked to have
   * handled cannot be retried, counted, or quietly turned into a value.
   */
  async invoke<T>(operation: () => PromiseLike<T> | T): Promise<ExecutionOutcome<T>> {
    const started = this.timer.now();
    let value: T;
    try {
      value = await operation();
    } catch (error) {
      const isHandled = this.handler.handlesError(error);
      this.failures.emit({
        durationMs: this.elapsed(started),
        handled: isHandled,
        reason: { error },
      });
      if (!isHandled) throw error;
      return { kind: "handled", reason: { error } };
    }
    if (this.handler.handlesResult(value)) {
      this.failures.emit({
        durationMs: this.elapsed(started),
        handled: true,
        reason: { value },
      });
      return { kind: "handled", reason: { value } };
    }
    this.successes.emit({ durationMs: this.elapsed(started) });
    return { kind: "success", value };
  }

  private elapsed(since: number): number {
    return this.timer.now() - since;
  }
}
