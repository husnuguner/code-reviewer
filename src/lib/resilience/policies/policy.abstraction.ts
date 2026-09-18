/**
 * The shape every policy presents, so that they are interchangeable.
 *
 * One `execute` and two events. A caller that holds an `IPolicy` cannot tell a
 * retry from a timeout from a no-op, which is what lets a policy be chosen by
 * configuration, stubbed in a test, or nested inside another.
 */

import { type Event } from "../events";
import { type IFailureEvent, type ISuccessEvent } from "../handling";

/** The least every policy hands the function it runs. */
export interface IDefaultPolicyContext {
  /** Aborted when the caller cancels, or when a policy's own limit elapses. */
  readonly signal: AbortSignal;
}

export interface IPolicy<C extends IDefaultPolicyContext = IDefaultPolicyContext> {
  /** Fired once when the call finally succeeds, however many attempts it took. */
  readonly onSuccess: Event<ISuccessEvent>;
  /** Fired for every attempt that failed, handled or not. */
  readonly onFailure: Event<IFailureEvent>;
  /**
   * `signal` accepts `null` as well as being omitted, because the platform
   * types a caller is most likely to forward one from -- `RequestInit.signal`
   * -- spells "no signal" that way.
   */
  execute<T>(
    operation: (context: C) => PromiseLike<T> | T,
    signal?: AbortSignal | null,
  ): Promise<T>;
}
