/**
 * What counts as a failure: the abstraction, and the composable `FailureHandler`.
 * @packageDocumentation
 */

export {
  type ExecutionOutcome,
  type FailureReason,
  type IFailureEvent,
  type IFailureHandler,
  type ISuccessEvent,
  unwrap,
} from "./failure.abstraction";
export {
  type Constructor,
  type ErrorFilter,
  FailureHandler,
  type ResultFilter,
} from "./failure.handler";
