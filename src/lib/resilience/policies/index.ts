/**
 * What to do about a failure: the `IPolicy` shape, the shared base, and the behaviours. `ExecutionRunner`
 * stays inside the folder.
 * @packageDocumentation
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
