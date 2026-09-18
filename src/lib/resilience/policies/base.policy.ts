/**
 * What every policy has before it has a behaviour.
 *
 * A retry and a timeout differ entirely in what `execute` does and not at all
 * in what surrounds it: both judge attempts through a handler, both keep a
 * clock, both publish the same two events. That shared half lives here, and
 * `execute` is left abstract -- the one thing a subclass exists to decide.
 *
 * The runner and the timer are `protected` rather than public: a subclass is
 * meant to build on them, and a caller is meant to see only `IPolicy`.
 */

import { type Event } from "../events";
import { type IFailureEvent, type IFailureHandler, type ISuccessEvent } from "../handling";
import { type ITimer } from "../timing";

import { ExecutionRunner } from "./execution.runner";
import { type IDefaultPolicyContext, type IPolicy } from "./policy.abstraction";

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
