/**
 * What to do about a failure.
 *
 * `IPolicy` is the shape they all share; `PolicyBase` is the half of it every
 * policy has before it has a behaviour; the rest are the behaviours.
 * `ExecutionRunner` stays inside the folder: it is how a policy judges one
 * attempt, not something a policy's caller holds.
 */

export { PolicyBase } from "./base.policy";
export { type IDefaultPolicyContext, type IPolicy } from "./policy.abstraction";
export {
  type IGiveUpEvent,
  type IRetryBackoffContext,
  type IRetryContext,
  type IRetryEvent,
  type IRetryOptions,
  RetryPolicy,
  retry,
} from "./retry.policy";
export { type ITimeoutOptions, TimeoutPolicy, TimeoutStrategy, timeout } from "./timeout.policy";
