/**
 * Which HTTP failures are worth asking about again, and for which methods.
 *
 * **Retrying a POST is not free, so it is not general.** `POST /reviews` is
 * not idempotent: a retry of a request the first attempt had already
 * committed posts the review twice. What separates a safe retry from a
 * duplicate review is whether the request can be shown *not* to have been
 * processed, so the two method classes get two tables rather than one table
 * and a flag:
 *
 * - Idempotent (GET, HEAD, PUT, DELETE, OPTIONS, TRACE) -- every transient
 *   status, every network failure, every timeout. Repeating them costs a
 *   request and nothing else.
 * - Everything else -- only `429` and `503`, which are refusals *to* process,
 *   and only the network failures that happened before a connection existed.
 *   A `502` or a timeout is precisely the ambiguous case: the request may
 *   well have been handled and the answer lost, so it is surfaced rather than
 *   repeated.
 *
 * The status tables follow `@octokit/plugin-retry`'s and GitHub's own
 * documented advice; none of it is novel, and that is the point.
 */

import { TaskCancelledError } from "../../lib/resilience/index";

/** Statuses worth repeating an idempotent request for. */
export const RETRYABLE_STATUS: ReadonlySet<number> = new Set([408, 425, 429, 500, 502, 503, 504]);

/**
 * Statuses worth repeating *any* request for, because they are a refusal to
 * process rather than a failure while processing.
 */
export const RETRYABLE_UNSAFE_STATUS: ReadonlySet<number> = new Set([429, 503]);

/** Methods a second identical request cannot change the outcome of. */
export const IDEMPOTENT_METHODS: ReadonlySet<string> = new Set([
  "GET",
  "HEAD",
  "PUT",
  "DELETE",
  "OPTIONS",
  "TRACE",
]);

/**
 * Network failures that happened before any request was delivered.
 *
 * Name resolution and a refused connection are proof that nothing reached the
 * server, which is what makes them safe to repeat for a POST. A reset socket
 * is deliberately not on this list: it can equally mean the request was
 * handled and the answer lost.
 */
const PRE_CONNECTION_CODES: ReadonlySet<string> = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ERR_SOCKET_CONNECTION_TIMEOUT",
]);

/**
 * Whether the attempt ran out of its own time rather than failing.
 *
 * Two spellings, because two things impose a deadline here. `TaskCancelledError`
 * is our own timeout policy's, and it is the one that actually happens: the
 * per-attempt limit is enforced above the transport, so a slow host surfaces
 * as that and never as a `DOMException`. The platform spellings are kept
 * because a transport is free to carry its own deadline and reject with one.
 */
export function isTimeout(error: unknown): boolean {
  return (
    error instanceof TaskCancelledError ||
    (error instanceof DOMException &&
      (error.name === "TimeoutError" || error.name === "AbortError"))
  );
}

/** `error.cause.code`, the errno a failed `fetch` carries underneath. */
export function causeCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const { cause } = error as { cause?: unknown };
  if (typeof cause !== "object" || cause === null) return null;
  const { code } = cause as { code?: unknown };
  return typeof code === "string" ? code : null;
}

/** Whether `fetch` rejected for a transport reason at all. */
export function isNetworkFailure(error: unknown): boolean {
  return error instanceof TypeError || causeCode(error) !== null;
}

/**
 * GitHub answers a rate limit with `403` as often as with `429`, and the only
 * thing that distinguishes it from a plain "you may not" is the headers.
 */
export function isRateLimited(response: Response): boolean {
  if (response.status === 429) return true;
  return response.status === 403
    ? response.headers.has("retry-after") || response.headers.get("x-ratelimit-remaining") === "0"
    : false;
}

/** Whether this response, for this method, is worth asking about again. */
export function isRetryableStatus(response: Response, isIdempotent: boolean): boolean {
  if (isRateLimited(response)) return true;
  return isIdempotent
    ? RETRYABLE_STATUS.has(response.status)
    : RETRYABLE_UNSAFE_STATUS.has(response.status);
}

/** Whether this rejection, for this method, is worth asking about again. */
export function isRetryableFailure(error: unknown, isIdempotent: boolean): boolean {
  // An attempt that timed out may have been processed; only a method that can
  // absorb being processed twice may repeat it.
  if (isTimeout(error)) return isIdempotent;
  if (!isNetworkFailure(error)) return false;
  if (isIdempotent) return true;
  const code = causeCode(error);
  return code !== null && PRE_CONNECTION_CODES.has(code);
}
