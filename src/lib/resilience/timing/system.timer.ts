/**
 * The real clock: the only `setTimeout` in the library, so a test can swap it and run a whole backoff
 * schedule instantly.
 * @packageDocumentation
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

/** The shared instance. */
export const systemTimer: ITimer = new SystemTimer();
