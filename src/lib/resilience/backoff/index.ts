/**
 * Backoff: the abstraction, two schedules, and the jitter generators.
 * @packageDocumentation
 */

export { type IBackoff, type IBackoffFactory, type JitterGenerator } from "./backoff.abstraction";
export { ConstantBackoff } from "./constant.backoff";
export { ExponentialBackoff, type IExponentialBackoffOptions } from "./exponential.backoff";
export { fullJitter, noJitter } from "./jitter.generators";
