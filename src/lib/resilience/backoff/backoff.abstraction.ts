/**
 * How long to wait before trying again: an immutable chain, so a strategy may carry state. Reads no clock.
 * @packageDocumentation
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

/** Spreads a computed window into an actual wait. */
export type JitterGenerator = (windowMs: number, random: () => number) => number;
