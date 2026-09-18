/**
 * What counts as a failure.
 *
 * The abstraction is the caller's verdict on one attempt; `FailureHandler` is
 * the composable value most callers will build that verdict from.
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
