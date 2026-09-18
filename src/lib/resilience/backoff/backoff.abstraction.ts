/**
 * How long to wait before trying again.
 *
 * A backoff is an immutable chain rather than a function of the attempt
 * number: a factory yields the first wait, and each wait yields the next.
 * That shape costs nothing for a constant or an exponential schedule, and it
 * is what lets a strategy carry state -- a decorrelated jitter deriving each
 * window from the last, a transport reading `Retry-After` off the response
 * that just failed -- without the policy knowing which kind it holds.
 *
 * Nothing here reads a clock or sleeps. A backoff says how long; the policy
 * decides whether there is time for it.
 */

/** Produces the first wait of a sequence. */
export interface IBackoffFactory<C> {
  next(context: C): IBackoff<C>;
}

/** One wait, and the sequence that follows it. */
export interface IBackoff<C> extends IBackoffFactory<C> {
  /** Milliseconds to wait before the attempt this precedes. */
  readonly duration: number;
}

/**
 * Spreads a computed window into an actual wait.
 *
 * The window is the ceiling the schedule reached; what a generator decides is
 * where inside it this particular client lands.
 */
export type JitterGenerator = (windowMs: number, random: () => number) => number;
