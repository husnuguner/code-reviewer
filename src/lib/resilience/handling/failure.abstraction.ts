/**
 * What counts as a failure, and what one attempt produced.
 *
 * The central idea, borrowed from Polly and Cockatiel: a policy does not get
 * to decide that a thrown error is a fault. Plenty of errors are the correct
 * answer -- a 404, a rejected input, a refusal to overwrite -- and retrying
 * them is at best waste and at worst a duplicate write. The caller states
 * which failures it wants handled; everything else leaves untouched.
 *
 * The second idea earns its keep even more: **a failure need not be an
 * exception**. `fetch` resolves quite happily with a 503, so a transport that
 * only understood thrown errors would have to invent one to get a retry, then
 * unwrap it again on the way out because the caller wants the `Response`.
 * Letting a *returned value* be a failure removes that round trip entirely.
 */

/** Why an attempt failed: it threw, or it returned something unacceptable. */
export type FailureReason<R> = { readonly error: unknown } | { readonly value: R };

/**
 * The value a reason carries, or the error it carries, thrown.
 *
 * This is where the library's central promise is kept: what the caller gets
 * back is what the operation produced, unwrapped. Callers branch on `error
 * instanceof GithubError` and on `response.status`, and a policy that wrapped
 * either one would turn every such branch into a silent `false` -- a failure
 * that shows up as a lost fallback rather than as an error.
 */
export function unwrap<R>(reason: FailureReason<R>): R {
  if ("error" in reason) throw reason.error;
  return reason.value;
}

export interface ISuccessEvent {
  readonly durationMs: number;
}

export interface IFailureEvent {
  readonly durationMs: number;
  /** Whether the handler recognised this as a fault it deals with. */
  readonly handled: boolean;
  readonly reason: FailureReason<unknown>;
}

/**
 * The verdict on one attempt: two questions, asked of the caller's rules.
 *
 * An interface rather than a pair of predicates so that a policy depends on
 * the decision, not on how it is spelled -- the built-in handler composes
 * filters, but a caller is free to hand over anything that can answer these
 * two questions.
 */
export interface IFailureHandler {
  /** Whether a thrown error is one the policy should act on. */
  handlesError(error: unknown): boolean;
  /** Whether a returned value should be treated as a failure. */
  handlesResult(value: unknown): boolean;
}

/**
 * What one attempt produced, once the handler has judged it.
 *
 * An error the handler did not claim never becomes an outcome: it is rethrown,
 * so a policy's loop cannot accidentally swallow it.
 */
export type ExecutionOutcome<T> =
  | { readonly kind: "success"; readonly value: T }
  | { readonly kind: "handled"; readonly reason: FailureReason<T> };
