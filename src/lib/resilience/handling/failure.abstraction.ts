/**
 * What counts as a failure, and what one attempt produced. The caller states which failures it wants
 * handled, and a returned value (a 503 `Response`) may be one.
 * @packageDocumentation
 */

/** Why an attempt failed: it threw, or it returned something unacceptable. */
export type FailureReason<R> = { readonly error: unknown } | { readonly value: R };

/**
 * The value a reason carries, or the error it carries, thrown.
 *
 * @remarks What the caller gets back is what the operation produced, unwrapped, so `instanceof` and
 * `response.status` branches still work.
 */
export function unwrap<R>(reason: FailureReason<R>): R {
  if ("error" in reason) throw reason.error;
  return reason.value;
}

/** A successful attempt. */
export interface ISuccessEvent {
  readonly durationMs: number;
}

/** A failed attempt. */
export interface IFailureEvent {
  readonly durationMs: number;
  /** Whether the handler recognised this as a fault it deals with. */
  readonly handled: boolean;
  readonly reason: FailureReason<unknown>;
}

/** The caller's verdict on one attempt. */
export interface IFailureHandler {
  /** Whether a thrown error is one the policy should act on. */
  handlesError(error: unknown): boolean;
  /** Whether a returned value should be treated as a failure. */
  handlesResult(value: unknown): boolean;
}

/** What one attempt produced, once judged. An unhandled error never becomes an outcome; it is rethrown. */
export type ExecutionOutcome<T> =
  | { readonly kind: "success"; readonly value: T }
  | { readonly kind: "handled"; readonly reason: FailureReason<T> };
