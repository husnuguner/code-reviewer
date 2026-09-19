/**
 * Gives the work a deadline and a signal that says so. Claims none of the caller's failures; the only
 * failure it introduces is its own `TaskCancelledError`.
 * @packageDocumentation
 */

import { PolicyError, TaskCancelledError } from "../errors";
import { type Event, EventPublisher } from "../events";
import { FailureHandler, unwrap } from "../handling";
import { type ITimer, systemTimer } from "../timing";

import { PolicyBase } from "./base.policy";
import { type IDefaultPolicyContext } from "./policy.abstraction";

/**
 * What to do when the deadline passes. `Cooperative` aborts the signal and waits for the work to notice;
 * `Aggressive` (default) also stops waiting, so a callee that ignores its signal cannot hang the caller.
 */
export const TimeoutStrategy = {
  Aggressive: "aggressive",
  Cooperative: "cooperative",
} as const;

/** One of {@link TimeoutStrategy}. */
export type TimeoutStrategy = (typeof TimeoutStrategy)[keyof typeof TimeoutStrategy];

/** Options for {@link TimeoutPolicy}. */
export interface ITimeoutOptions {
  readonly strategy?: TimeoutStrategy;
  /** Injectable so a test need not spend the deadline. */
  readonly timer?: ITimer;
}

/** An abort reason as something throwable. */
function abortReason(reason: unknown): Error {
  return reason instanceof Error ? reason : new TaskCancelledError("The work was cancelled.");
}

function noop(): void {
  // deliberately empty
}

/** Observes a promise nobody will read, so the loser of a race is not an unhandled rejection. */
async function swallow(work: Promise<unknown>): Promise<void> {
  try {
    await work;
  } catch {
    // Already reported by the race, or no longer relevant.
  }
}

/** Abandons the work after a fixed duration. */
export class TimeoutPolicy extends PolicyBase<IDefaultPolicyContext> {
  /** Fired when the deadline passes, whether or not the work notices. */
  readonly onTimeout: Event<void>;

  private readonly timeouts = new EventPublisher<void>();
  private readonly strategy: TimeoutStrategy;

  /**
   * @throws {@link PolicyError} when `durationMs` is not a positive whole number.
   */
  constructor(
    private readonly durationMs: number,
    options: ITimeoutOptions = {},
  ) {
    super(FailureHandler.none, options.timer ?? systemTimer);
    if (!Number.isSafeInteger(durationMs) || durationMs <= 0) {
      throw new PolicyError(
        `A timeout must be a positive whole number of milliseconds, got: ${String(durationMs)}`,
      );
    }
    this.strategy = options.strategy ?? TimeoutStrategy.Aggressive;
    this.onTimeout = this.timeouts.addListener;
  }

  /** A promise that only ever rejects, once `signal` aborts. */
  private static rejectWhenAborted<T>(signal: AbortSignal): Promise<T> {
    return new Promise((_resolve, reject) => {
      if (signal.aborted) {
        reject(abortReason(signal.reason));
        return;
      }
      signal.addEventListener(
        "abort",
        () => {
          reject(abortReason(signal.reason));
        },
        { once: true },
      );
    });
  }

  /**
   * Runs `operation` under the deadline, linked to the caller's signal.
   *
   * @throws `TaskCancelledError` when the deadline passes; the work's own errors unchanged.
   */
  async execute<T>(
    operation: (context: IDefaultPolicyContext) => PromiseLike<T> | T,
    signal?: AbortSignal | null,
  ): Promise<T> {
    const controller = new AbortController();
    const unlink = this.linkCaller(signal, controller);
    const handle = setTimeout(() => {
      this.timeouts.emit();
      controller.abort(new TaskCancelledError(`Timed out after ${String(this.durationMs)}ms.`));
    }, this.durationMs);
    try {
      const outcome = await this.runner.invoke(() => this.run(operation, controller.signal));
      return outcome.kind === "success" ? outcome.value : unwrap(outcome.reason);
    } finally {
      clearTimeout(handle);
      unlink();
    }
  }

  /** Runs the work under `signal`, racing the deadline when aggressive. */
  private async run<T>(
    operation: (context: IDefaultPolicyContext) => PromiseLike<T> | T,
    signal: AbortSignal,
  ): Promise<T> {
    const work = Promise.resolve(operation({ signal }));
    if (this.strategy === TimeoutStrategy.Cooperative) return work;
    void swallow(work);
    return Promise.race([work, TimeoutPolicy.rejectWhenAborted<T>(signal)]);
  }

  /** Makes the caller's cancellation cancel ours too; the result unlinks. */
  private linkCaller(
    signal: AbortSignal | null | undefined,
    controller: AbortController,
  ): () => void {
    if (signal == null) return noop;
    if (signal.aborted) {
      controller.abort(signal.reason);
      return noop;
    }
    const forward = (): void => {
      controller.abort(signal.reason);
    };
    signal.addEventListener("abort", forward, { once: true });
    return () => {
      signal.removeEventListener("abort", forward);
    };
  }
}

/** A policy that abandons the work after `durationMs`. */
export function timeout(durationMs: number, options: ITimeoutOptions = {}): TimeoutPolicy {
  return new TimeoutPolicy(durationMs, options);
}
