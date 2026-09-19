/**
 * The clock and the wait as one replaceable pair: a budget is a difference of two readings, so a test
 * must replace both.
 * @packageDocumentation
 */

/** A clock that can also wait. */
export interface ITimer {
  /** Milliseconds from some fixed point; only differences are read. */
  now(): number;
  /**
   * Waits `ms`, or stops early when `signal` aborts.
   *
   * @throws `TaskCancelledError` on abort; an aborted wait must not look like one that finished.
   */
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}
