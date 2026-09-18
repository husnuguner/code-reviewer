/**
 * The clock a policy reads and the wait it takes, as one replaceable thing.
 *
 * Both halves together, never one: a budget is the difference between two
 * readings of a clock, so a test that replaced the sleeping and not the time
 * would measure a budget nothing ever spends -- and would pass while the real
 * policy waited for minutes. Replacing them as a pair is what makes a whole
 * backoff table testable in the millisecond it takes to run.
 */
export interface ITimer {
  /** Milliseconds from some fixed point; only differences are ever read. */
  now(): number;
  /**
   * Wait `ms`, or stop early if `signal` aborts.
   *
   * An aborted wait *rejects*. It must not look like a wait that finished, or
   * the caller would go on to make the attempt nobody is waiting for any more.
   */
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}
