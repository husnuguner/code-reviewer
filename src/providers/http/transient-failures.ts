/**
 * Which HTTP failures are worth retrying, and for which methods. Two tables: idempotent methods retry
 * every transient failure; others only refusals-to-process (`429`, `503`) and pre-connection network
 * errors, since a retried `POST /reviews` could post twice.
 * @packageDocumentation
 */

import { TaskCancelledError } from "../../lib/resilience/index";

/** Statuses worth repeating an idempotent request for. */
export const RETRYABLE_STATUS: ReadonlySet<number> = new Set([408, 425, 429, 500, 502, 503, 504]);

/** Statuses worth repeating any request for: refusals to process, not failures while processing. */
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
 * Network failures that prove nothing reached the server, in Node's errno spelling and Bun's own
 * (`ConnectionRefused`, `FailedToOpenSocket`). A reset socket is deliberately absent: Bun spells a
 * connection closed after the request went out `ECONNRESET`, and its socket timeout `ETIMEDOUT` can
 * fire while awaiting the answer, so neither proves the request was never processed.
 */
const PRE_CONNECTION_CODES: ReadonlySet<string> = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ERR_SOCKET_CONNECTION_TIMEOUT",
  "ConnectionRefused",
  "FailedToOpenSocket",
]);

/** Whether the attempt ran out of time: our own timeout policy's error, or a platform abort/timeout. */
export function isTimeout(error: unknown): boolean {
  return (
    error instanceof TaskCancelledError ||
    (error instanceof DOMException &&
      (error.name === "TimeoutError" || error.name === "AbortError"))
  );
}

/**
 * The code a failed `fetch` carries, or `null`: Bun puts it on the error itself (`error.code`), Node
 * underneath (`error.cause.code`). The error's own code wins when both are present.
 */
export function causeCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const { code, cause } = error as { code?: unknown; cause?: unknown };
  if (typeof code === "string") return code;
  if (typeof cause !== "object" || cause === null) return null;
  const { code: nested } = cause as { code?: unknown };
  return typeof nested === "string" ? nested : null;
}

/** Whether `fetch` rejected for a transport reason. */
export function isNetworkFailure(error: unknown): boolean {
  return error instanceof TypeError || causeCode(error) !== null;
}

/** Whether the response is a rate limit: `429`, or GitHub's `403` with rate-limit headers. */
export function isRateLimited(response: Response): boolean {
  if (response.status === 429) return true;
  return response.status === 403
    ? response.headers.has("retry-after") || response.headers.get("x-ratelimit-remaining") === "0"
    : false;
}

/** Whether this response, for this method, is worth retrying. */
export function isRetryableStatus(response: Response, isIdempotent: boolean): boolean {
  if (isRateLimited(response)) return true;
  return isIdempotent
    ? RETRYABLE_STATUS.has(response.status)
    : RETRYABLE_UNSAFE_STATUS.has(response.status);
}

/** Whether this rejection, for this method, is worth retrying. A timeout may have been processed. */
export function isRetryableFailure(error: unknown, isIdempotent: boolean): boolean {
  if (isTimeout(error)) return isIdempotent;
  if (!isNetworkFailure(error)) return false;
  if (isIdempotent) return true;
  const code = causeCode(error);
  return code !== null && PRE_CONNECTION_CODES.has(code);
}
