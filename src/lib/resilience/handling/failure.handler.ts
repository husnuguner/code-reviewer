/**
 * The caller's rules about what counts as a fault, as one immutable, composable value.
 * @packageDocumentation
 */

import { type IFailureHandler } from "./failure.abstraction";

/** Whether a thrown error is handled. */
export type ErrorFilter = (error: unknown) => boolean;
/** Whether a returned value is a failure. */
export type ResultFilter = (value: unknown) => boolean;

/** A class, as `ofType` takes one. */
export type Constructor<T> = new (...arguments_: never[]) => T;

const isNever: ErrorFilter & ResultFilter = () => false;
const isAlways: ErrorFilter = () => true;

/** Composes error and result filters; every `or*` returns a new handler. Built through the named constructors. */
export class FailureHandler implements IFailureHandler {
  /** Handles every thrown error and no returned value. */
  static readonly all = new FailureHandler(isAlways, isNever);

  /** Handles nothing; for a policy that adds a limit, not a judgement (a timeout). */
  static readonly none = new FailureHandler(isNever, isNever);

  private constructor(
    private readonly isHandledError: ErrorFilter,
    private readonly isHandledResult: ResultFilter,
  ) {}

  /** Handles errors of `ctor`, optionally narrowed by `isMatch`. */
  static ofType<E>(ctor: Constructor<E>, isMatch?: (error: E) => boolean): FailureHandler {
    return this.none.orType(ctor, isMatch);
  }

  /** Handles any thrown error `isMatch` accepts. */
  static when(isMatch: ErrorFilter): FailureHandler {
    return this.none.orWhen(isMatch);
  }

  /** Treats any returned value `isMatch` accepts as a failure. */
  static whenResult(isMatch: ResultFilter): FailureHandler {
    return this.none.orWhenResult(isMatch);
  }

  /** Also handles errors of `ctor`, optionally narrowed by `isMatch`. */
  orType<E>(ctor: Constructor<E>, isMatch?: (error: E) => boolean): FailureHandler {
    return this.orWhen(
      (error) => error instanceof ctor && (isMatch === undefined || isMatch(error)),
    );
  }

  /** Also handles any thrown error `isMatch` accepts. */
  orWhen(isMatch: ErrorFilter): FailureHandler {
    return new FailureHandler(
      (error) => this.isHandledError(error) || isMatch(error),
      this.isHandledResult,
    );
  }

  /** Also treats any returned value `isMatch` accepts as a failure. */
  orWhenResult(isMatch: ResultFilter): FailureHandler {
    return new FailureHandler(this.isHandledError, (value) => {
      return this.isHandledResult(value) || isMatch(value);
    });
  }

  handlesError(error: unknown): boolean {
    return this.isHandledError(error);
  }

  handlesResult(value: unknown): boolean {
    return this.isHandledResult(value);
  }
}
