/**
 * How long to wait before trying again.
 *
 * The abstraction is an immutable chain; the two schedules and the jitter
 * generators are the implementations this library ships with.
 */

export { type IBackoff, type IBackoffFactory, type JitterGenerator } from "./backoff.abstraction";
export { ConstantBackoff } from "./constant.backoff";
export { ExponentialBackoff, type IExponentialBackoffOptions } from "./exponential.backoff";
export { fullJitter, noJitter } from "./jitter.generators";
