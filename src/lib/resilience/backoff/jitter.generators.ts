/**
 * Where inside a computed window a client actually lands.
 *
 * The strategy half of the exponential schedule, separated because it is the
 * half with a real trade-off: the schedule decides how patient to be, the
 * jitter decides whether a thousand clients are patient *together*.
 */

import { type JitterGenerator } from "./backoff.abstraction";

/** Wait the whole window, every time. Predictable, and the worst under load. */
export const noJitter: JitterGenerator = (windowMs) => windowMs;

/**
 * Anywhere in `[0, window]`, uniformly.
 *
 * The default, and the one AWS measured as doing the least total work while
 * putting the least load on the server being retried. Clients that failed
 * together would otherwise wake together and re-stampede a service that was
 * just recovering; spreading them across the whole window is what stops that
 * (Marc Brooker, "Exponential Backoff And Jitter").
 */
export const fullJitter: JitterGenerator = (windowMs, random) => Math.round(random() * windowMs);
