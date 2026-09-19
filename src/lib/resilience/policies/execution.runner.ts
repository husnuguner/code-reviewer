/**
 * One attempt, judged: the handler's verdict, the duration, and the success/failure events, in one place.
 * @packageDocumentation
 */

import { type Event, EventPublisher } from "../events";
import {
  type ExecutionOutcome,
  type IFailureEvent,
  type IFailureHandler,
  type ISuccessEvent,
} from "../handling";
import { type ITimer } from "../timing";

/** Runs the caller's function once and judges the result. */
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
   * Runs `operation` once.
   *
   * @returns The outcome when the handler recognises it.
   * @throws The error itself when the handler does not, so a policy cannot retry or swallow what the
   * caller never asked to have handled.
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
