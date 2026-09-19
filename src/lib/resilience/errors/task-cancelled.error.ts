/**
 * The work was abandoned before it could answer.
 * @packageDocumentation
 */

/** A timeout elapsed or the caller's signal aborted. Named so "whose deadline" is answerable. */
export class TaskCancelledError extends Error {
  override readonly name = "TaskCancelledError";
}
