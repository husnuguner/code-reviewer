/**
 * A window that grows with each attempt, jittered, and capped.
 *
 * The factory is immutable and reusable; each `next()` walks one step further
 * along a chain it creates lazily, so two executions sharing one factory do
 * not share a position in the sequence.
 */

import { type IBackoff, type IBackoffFactory, type JitterGenerator } from "./backoff.abstraction";
import { fullJitter } from "./jitter.generators";

export interface IExponentialBackoffOptions {
  /** The first window, in milliseconds. */
  readonly initialDelay?: number;
  /** The window's ceiling, so attempt twenty is not an hour. */
  readonly maxDelay?: number;
  /** What the window is multiplied by each attempt. */
  readonly exponent?: number;
  /** Where inside the window this client lands. */
  readonly generator?: JitterGenerator;
  /** Injected so a test can pin the wait. */
  readonly random?: () => number;
}

const DEFAULTS = {
  initialDelay: 128,
  maxDelay: 30_000,
  exponent: 2,
  generator: fullJitter,
  random: Math.random,
} satisfies Required<IExponentialBackoffOptions>;

export class ExponentialBackoff<C = unknown> implements IBackoffFactory<C> {
  private readonly options: Required<IExponentialBackoffOptions>;

  constructor(options: IExponentialBackoffOptions = {}) {
    this.options = { ...DEFAULTS, ...options };
  }

  next(): IBackoff<C> {
    return this.step(1);
  }

  /** The `index`-th wait of the sequence, and the tail that follows it. */
  private step(index: number): IBackoff<C> {
    const { initialDelay, maxDelay, exponent, generator, random } = this.options;
    const window = Math.min(maxDelay, initialDelay * exponent ** (index - 1));
    const duration = Math.max(0, generator(window, random));
    return { duration, next: () => this.step(index + 1) };
  }
}
