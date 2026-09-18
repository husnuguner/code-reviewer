/**
 * The caller's rules about what counts as a fault, as one object.
 *
 * Immutable, and every `or*` returns a new one, so a handler built once can be
 * given to a retry policy here and a timeout there without either being able
 * to widen the other. Built through the named constructors rather than
 * `new`: `FailureHandler.whenResult(...)` says what the object is for, where
 * a constructor taking two predicates would only say what it is made of.
 *
 * The filters are private. Callers ask `handlesError(...)`, they do not read
 * the rule and decide for themselves -- which is what keeps the composition
 * below the only way rules are combined.
 */

import { type IFailureHandler } from "./failure.abstraction";

export type ErrorFilter = (error: unknown) => boolean;
export type ResultFilter = (value: unknown) => boolean;

/** A class, as `ofType` takes one; its arguments are never supplied. */
export type Constructor<T> = new (...arguments_: never[]) => T;

const isNever: ErrorFilter & ResultFilter = () => false;
const isAlways: ErrorFilter = () => true;

export class FailureHandler implements IFailureHandler {
  /** Handle every thrown error, and no returned value. */
  static readonly all = new FailureHandler(isAlways, isNever);

  /**
   * Handle nothing at all.
   *
   * Not a curiosity: a policy that adds a limit rather than a judgement -- a
   * timeout, say -- runs the caller's function through the same machinery and
   * must claim none of its failures, so that every one of them leaves exactly
   * as it arrived.
   */
  static readonly none = new FailureHandler(isNever, isNever);

  private constructor(
    private readonly isHandledError: ErrorFilter,
    private readonly isHandledResult: ResultFilter,
  ) {}

  /** Handle errors of `ctor`, optionally narrowed by `isMatch`. */
  static ofType<E>(ctor: Constructor<E>, isMatch?: (error: E) => boolean): FailureHandler {
    return this.none.orType(ctor, isMatch);
  }

  /** Handle any thrown error `isMatch` accepts. */
  static when(isMatch: ErrorFilter): FailureHandler {
    return this.none.orWhen(isMatch);
  }

  /** Treat any returned value `isMatch` accepts as a failure. */
  static whenResult(isMatch: ResultFilter): FailureHandler {
    return this.none.orWhenResult(isMatch);
  }

  /** Also handle errors of `ctor`, optionally narrowed by `isMatch`. */
  orType<E>(ctor: Constructor<E>, isMatch?: (error: E) => boolean): FailureHandler {
    return this.orWhen(
      (error) => error instanceof ctor && (isMatch === undefined || isMatch(error)),
    );
  }

  /** Also handle any thrown error `isMatch` accepts. */
  orWhen(isMatch: ErrorFilter): FailureHandler {
    return new FailureHandler(
      (error) => this.isHandledError(error) || isMatch(error),
      this.isHandledResult,
    );
  }

  /** Also treat any returned value `isMatch` accepts as a failure. */
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
