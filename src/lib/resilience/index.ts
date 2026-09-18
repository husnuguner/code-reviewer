/**
 * A small resilience library: policies that decide when to try again.
 *
 * Modelled on Cockatiel (itself modelled on .NET's Polly), cut down to what
 * this program actually needs. The shape is deliberate rather than decorative:
 *
 * - **A handler says what a failure is.** `FailureHandler` is the caller's
 *   rules, not the policy's guess -- including the rule that a *returned
 *   value* can be a failure, which is what lets an HTTP 503 be retried
 *   without inventing an exception to carry it.
 * - **A backoff says how long to wait.** An immutable chain, so a strategy
 *   may carry state (a `Retry-After` header, a decorrelated window) without
 *   the policy knowing which kind it holds.
 * - **A policy says what to do about it.** `IPolicy` is one `execute` and two
 *   events, so a retry, a timeout and a stub are interchangeable.
 *
 * Deliberately absent: circuit breakers (nothing here outlives one command),
 * bulkheads (`p-limit` already bounds concurrency), and fallbacks (the one
 * place that needs one states it in its own terms). Each is a file to add,
 * not a design to revisit.
 *
 * Nothing in here knows about HTTP, this repository, or its domain; it
 * imports from no other part of `src/`, which is what makes `lib/` the layer
 * every other layer may depend on.
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
// `EventPublisher` is deliberately not exported: a consumer subscribes through
// `Event<T>` and never needs the class that stores the listeners.
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
