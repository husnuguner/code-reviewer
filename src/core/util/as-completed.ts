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

export async function* asCompleted<T>(promises: readonly Promise<T>[]): AsyncGenerator<Settled<T>> {
  // Attach to every promise now, before the consumer awaits anything: a
  // rejection must land in `settle`'s catch, not on the process.
  const pending = new Map(promises.map((promise, index) => [index, settle(promise, index)]));
  while (pending.size > 0) {
    const winner = await Promise.race(pending.values());
    pending.delete(winner.index);
    yield winner.result;
  }
}
