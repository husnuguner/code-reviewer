/**
 * The real clock, and the only place in this library that schedules anything.
 *
 * Every policy takes an `ITimer`, and this is what they take when nobody says
 * otherwise. Keeping the single `setTimeout` here is what lets the rest of
 * the library be pure: a test swaps this for a recording timer and the whole
 * backoff schedule runs instantly, with the waits asserted rather than spent.
 */

import { TaskCancelledError } from "../errors";

import { type ITimer } from "./timer.abstraction";

class SystemTimer implements ITimer {
  now(): number {
    return Date.now();
  }

  sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted === true) {
        reject(new TaskCancelledError("The wait was cancelled before it began."));
        return;
      }
      const onAbort = (): void => {
        clearTimeout(handle);
        reject(new TaskCancelledError("The wait was cancelled."));
      };
      const handle = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }
}

/** The shared instance; it holds no state worth having twice. */
export const systemTimer: ITimer = new SystemTimer();
