/**
 * The errors this library raises on its own behalf.
 *
 * Deliberately few. A resilience policy's job is to hand back what the
 * operation produced -- the value it returned or the error it threw,
 * unchanged -- so the only errors declared here are the ones no operation
 * could have produced, because the policy itself is what happened.
 */

export { PolicyError } from "./policy.error";
export { TaskCancelledError } from "./task-cancelled.error";
