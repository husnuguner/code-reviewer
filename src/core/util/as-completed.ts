/**
 * Yield promise results in completion order, never leaving a rejection
 * unobserved.
 *
 * Every promise handed in is attached to immediately, so a rejection that
 * happens while the consumer is busy elsewhere is stored rather than raised
 * as an unhandled rejection. Each settled promise is yielded exactly once, as
 * `{ ok: true, value }` or `{ ok: false, error }`, so the consumer decides
 * what a failure means.
 */

export type Settled<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: unknown };

interface Tagged<T> {
  readonly index: number;
  readonly result: Settled<T>;
}

/** One promise's outcome as a value that never rejects, tagged with its slot. */
async function settle<T>(promise: Promise<T>, index: number): Promise<Tagged<T>> {
  try {
    return { index, result: { ok: true, value: await promise } };
  } catch (error) {
    return { index, result: { ok: false, error } };
  }
}

/**
 * Deliberately NOT an `async function*`.
 *
 * An async generator's body does not run until its first `next()`, so the
 * attachment below would be deferred for as long as the consumer took to
 * start iterating -- and a promise that rejected in that window would be
 * reported as an unhandled rejection, which is the one thing this module
 * exists to prevent. Attaching here, in an ordinary function that returns
 * the generator, is what makes "attached immediately" true rather than
 * merely intended.
 */
export function asCompleted<T>(promises: readonly Promise<T>[]): AsyncGenerator<Settled<T>> {
  const pending = new Map(promises.map((promise, index) => [index, settle(promise, index)]));
  return drain(pending);
}

/** Yield each settled outcome once, soonest first, until none is left. */
async function* drain<T>(pending: Map<number, Promise<Tagged<T>>>): AsyncGenerator<Settled<T>> {
  while (pending.size > 0) {
    const winner = await Promise.race(pending.values());
    pending.delete(winner.index);
    yield winner.result;
  }
}
