/**
 * A small resilience library modelled on Cockatiel: a handler says what a failure is, a backoff says how
 * long to wait, a policy says what to do. Imports nothing else from `src/`.
 * @packageDocumentation
 */

export {
  ConstantBackoff,
  ExponentialBackoff,
  fullJitter,
  type IBackoff,
  type IBackoffFactory,
  type IExponentialBackoffOptions,
  type JitterGenerator,
  noJitter,
} from "./backoff";
export { PolicyError, TaskCancelledError } from "./errors";
// `EventPublisher` is not exported: consumers subscribe through `Event<T>`.
export { type Event, type IDisposable, type IEventPublisher, type Listener } from "./events";
export {
  type Constructor,
  type ErrorFilter,
  type ExecutionOutcome,
  FailureHandler,
  type FailureReason,
  type IFailureEvent,
  type IFailureHandler,
  type ISuccessEvent,
  type ResultFilter,
  unwrap,
} from "./handling";
export {
  type IDefaultPolicyContext,
  type IGiveUpEvent,
  type IPolicy,
  type IRetryBackoffContext,
  type IRetryContext,
  type IRetryEvent,
  type IRetryOptions,
  type ITimeoutOptions,
  PolicyBase,
  RetryPolicy,
  retry,
  TimeoutPolicy,
  TimeoutStrategy,
  timeout,
} from "./policies";
export { type ITimer, systemTimer } from "./timing";
