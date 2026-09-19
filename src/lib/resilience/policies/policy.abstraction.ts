/**
 * The shape every policy presents: one `execute` and two events, so a retry, a timeout and a stub are
 * interchangeable.
 * @packageDocumentation
 */

import { type Event } from "../events";
import { type IFailureEvent, type ISuccessEvent } from "../handling";

/** The least every policy hands the function it runs. */
export interface IDefaultPolicyContext {
  /** Aborted when the caller cancels, or when a policy's own limit elapses. */
  readonly signal: AbortSignal;
}

/** A policy. */
export interface IPolicy<C extends IDefaultPolicyContext = IDefaultPolicyContext> {
  /** Fired once when the call finally succeeds. */
  readonly onSuccess: Event<ISuccessEvent>;
  /** Fired for every attempt that failed, handled or not. */
  readonly onFailure: Event<IFailureEvent>;
  /**
   * Runs `operation` under the policy.
   *
   * @param signal - Accepts `null` as well, since `RequestInit.signal` spells "none" that way.
   */
  execute<T>(
    operation: (context: C) => PromiseLike<T> | T,
    signal?: AbortSignal | null,
  ): Promise<T>;
}
