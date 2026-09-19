/**
 * What every policy shares before it has a behaviour: a handler, a clock, and two events.
 * @packageDocumentation
 */

import { type Event } from "../events";
import { type IFailureEvent, type IFailureHandler, type ISuccessEvent } from "../handling";
import { type ITimer } from "../timing";

import { ExecutionRunner } from "./execution.runner";
import { type IDefaultPolicyContext, type IPolicy } from "./policy.abstraction";

/** The shared half of a policy; `execute` is the subclass's. */
export abstract class PolicyBase<C extends IDefaultPolicyContext> implements IPolicy<C> {
  readonly onSuccess: Event<ISuccessEvent>;
  readonly onFailure: Event<IFailureEvent>;

  protected readonly runner: ExecutionRunner;
  protected readonly timer: ITimer;

  protected constructor(handler: IFailureHandler, timer: ITimer) {
    this.timer = timer;
    this.runner = new ExecutionRunner(handler, timer);
    this.onSuccess = this.runner.onSuccess;
    this.onFailure = this.runner.onFailure;
  }

  abstract execute<T>(
    operation: (context: C) => PromiseLike<T> | T,
    signal?: AbortSignal | null,
  ): Promise<T>;
}
