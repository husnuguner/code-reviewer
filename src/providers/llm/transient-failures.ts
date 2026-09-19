/**
 * Which model-call failures are worth retrying. The status table is the transport's; a completion has no
 * side effect to duplicate, so every attempt is safe to repeat.
 * @packageDocumentation
 */

import { APICallError } from "ai";

import { isNetworkFailure, isTimeout, RETRYABLE_STATUS } from "../http/transient-failures";

/**
 * Whether a model-call failure should be retried.
 *
 * @returns The SDK's own verdict where offered, else whether the status, a timeout or a network failure
 * says so. An error that crossed a proxy arrives without an `APICallError`; the fallbacks catch it.
 */
export function isRetryableModelFailure(error: unknown): boolean {
  return APICallError.isInstance(error)
    ? error.isRetryable || isRetryableStatus(error.statusCode)
    : isTimeout(error) || isNetworkFailure(error);
}

/** A transient status, or none at all (the request never got an answer). */
function isRetryableStatus(status: number | undefined): boolean {
  return status === undefined || RETRYABLE_STATUS.has(status);
}
