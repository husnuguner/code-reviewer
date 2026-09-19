/**
 * Where inside a computed window a client lands: whether a thousand clients are patient together.
 * @packageDocumentation
 */

import { type JitterGenerator } from "./backoff.abstraction";

/** The whole window, every time. Predictable, and the worst under load. */
export const noJitter: JitterGenerator = (windowMs) => windowMs;

/**
 * Uniformly anywhere in `[0, window]`.
 *
 * @remarks The default; the strategy AWS measured as least total work and least server load
 * ("Exponential Backoff And Jitter", Marc Brooker).
 */
export const fullJitter: JitterGenerator = (windowMs, random) => Math.round(random() * windowMs);
