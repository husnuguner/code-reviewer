/** A policy given options it cannot honour: a programming error, not a fault. */
export class PolicyError extends Error {
  override readonly name = "PolicyError";
}
