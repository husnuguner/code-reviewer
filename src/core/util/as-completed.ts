/**
 * Yields promise results in completion order without leaving a rejection unobserved.
 * @packageDocumentation
 */

/** One promise's outcome: a value, or the error it rejected with. */
export type Settled<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: unknown };

interface Tagged<T> {
  readonly index: number;
  readonly result: Settled<T>;
}

/** Wraps a promise so it never rejects, tagging the result with its slot. */
async function settle<T>(promise: Promise<T>, index: number): Promise<Tagged<T>> {
  try {
    return { index, result: { ok: true, value: await promise } };
  } catch (error) {
    return { index, result: { ok: false, error } };
  }
}

/**
 * Yields each promise's outcome once, soonest first.
 *
 * @param promises - The promises to observe; every one is attached to immediately.
 * @returns An async generator of `Settled` outcomes.
 * @remarks Not an `async function*`: a generator body runs only on the first `next()`,
 * and a rejection before that would surface as unhandled.
 */
export function asCompleted<T>(promises: readonly Promise<T>[]): AsyncGenerator<Settled<T>> {
  const pending = new Map(promises.map((promise, index) => [index, settle(promise, index)]));
  return drain(pending);
}

/** Yields each settled outcome once until none is left. */
async function* drain<T>(pending: Map<number, Promise<Tagged<T>>>): AsyncGenerator<Settled<T>> {
  while (pending.size > 0) {
    const winner = await Promise.race(pending.values());
    pending.delete(winner.index);
    yield winner.result;
  }
}
