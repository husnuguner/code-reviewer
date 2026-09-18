/**
 * Which model-call failures are worth asking about again.
 *
 * A completion request is an HTTP request underneath, so the status table is
 * the transport's own rather than a second copy of it -- a vendor returning
 * 503 means what a 503 means, and two tables would eventually disagree.
 *
 * Every attempt here is safe to repeat. A completion has no side effect to
 * duplicate: unlike a POST that creates a review, asking twice costs tokens
 * and nothing else, which is why there is no idempotence question in this
 * file and no second table for it.
 */

import { APICallError } from "ai";

import { isNetworkFailure, isTimeout, RETRYABLE_STATUS } from "../http/transient-failures";

/**
 * Whether the SDK's own verdict, or the shape of the failure, says to retry.
 *
 * `APICallError.isRetryable` is the SDK's reading and is trusted where it is
 * offered. The fallbacks below matter more than they look: an error that
 * crossed a gateway or a proxy arrives as something else entirely -- which is
 * exactly the case the SDK's built-in retry silently skips -- and our own
 * per-attempt deadline arrives as a `TaskCancelledError` that no vendor
 * knows about.
 */
export function isRetryableModelFailure(error: unknown): boolean {
  return APICallError.isInstance(error)
    ? error.isRetryable || isRetryableStatus(error.statusCode)
    : isTimeout(error) || isNetworkFailure(error);
}

/** A status the transport already calls transient, or none at all. */
function isRetryableStatus(status: number | undefined): boolean {
  // No status means the request never got an answer, which is the most
  // retryable thing there is.
  return status === undefined || RETRYABLE_STATUS.has(status);
}
