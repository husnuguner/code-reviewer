/**
 * A policy given options it cannot honour.
 * @packageDocumentation
 */

/** A programming error in a policy's options, not a fault of the operation. */
export class PolicyError extends Error {
  override readonly name = "PolicyError";
}
