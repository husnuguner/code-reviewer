/**
 * A window that grows with each attempt, jittered and capped. The factory is reusable; each chain is
 * created lazily, so executions sharing one factory do not share a position.
 * @packageDocumentation
 */

import { type IBackoff, type IBackoffFactory, type JitterGenerator } from "./backoff.abstraction";
import { fullJitter } from "./jitter.generators";

/** Options for {@link ExponentialBackoff}. */
export interface IExponentialBackoffOptions {
  /** The first window, in milliseconds. Default 128. */
  readonly initialDelay?: number;
  /** The window's ceiling. Default 30 000. */
  readonly maxDelay?: number;
  /** The window's multiplier per attempt. Default 2. */
  readonly exponent?: number;
  /** Where inside the window this client lands. Default {@link fullJitter}. */
  readonly generator?: JitterGenerator;
  /** Injectable so a test can pin the wait. */
  readonly random?: () => number;
}

const DEFAULTS = {
  initialDelay: 128,
  maxDelay: 30_000,
  exponent: 2,
  generator: fullJitter,
  random: Math.random,
} satisfies Required<IExponentialBackoffOptions>;

/** An exponential schedule. */
export class ExponentialBackoff<C = unknown> implements IBackoffFactory<C> {
  private readonly options: Required<IExponentialBackoffOptions>;

  constructor(options: IExponentialBackoffOptions = {}) {
    this.options = { ...DEFAULTS, ...options };
  }

  next(): IBackoff<C> {
    return this.step(1);
  }

  /** The `index`-th wait, and the tail that follows it. */
  private step(index: number): IBackoff<C> {
    const { initialDelay, maxDelay, exponent, generator, random } = this.options;
    const window = Math.min(maxDelay, initialDelay * exponent ** (index - 1));
    const duration = Math.max(0, generator(window, random));
    return { duration, next: () => this.step(index + 1) };
  }
}
