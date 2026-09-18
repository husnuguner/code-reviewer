/**
 * The work was abandoned before it could answer: a timeout elapsed, or the
 * caller's signal was aborted.
 *
 * Named rather than reusing `DOMException`, because "whose deadline was it"
 * is the question a caller actually has, and a `TimeoutError` from a nested
 * `fetch` answers it differently from this one.
 */
export class TaskCancelledError extends Error {
  override readonly name = "TaskCancelledError";
}
