/**
 * Give the work a deadline, and a signal that says so.
 *
 * A policy that adds a limit rather than a judgement: it claims none of the
 * caller's failures (`FailureHandler.none`), so everything the work throws
 * leaves exactly as it arrived. The only failure it introduces is its own
 * `TaskCancelledError`.
 *
 * The signal handed to the work is the point. A cooperative callee -- `fetch`
 * is one -- aborts the moment the deadline passes, releasing the socket
 * rather than leaving it to a garbage collector.
 */

import { PolicyError, TaskCancelledError } from "../errors";
import { type Event, EventPublisher } from "../events";
import { FailureHandler, unwrap } from "../handling";
import { type ITimer, systemTimer } from "../timing";

import { PolicyBase } from "./base.policy";
import { type IDefaultPolicyContext } from "./policy.abstraction";

/**
 * What to do when the deadline passes.
 *
 * `Cooperative` only aborts the signal and waits for the work to notice --
 * correct, and exactly right for a callee that honours signals. `Aggressive`
 * additionally stops waiting, so a callee that ignores its signal cannot hold
 * the caller past the deadline. Aggressive is the default because the cost of
 * being wrong the other way is a hang.
 */
export const TimeoutStrategy = {
  Aggressive: "aggressive",
  Cooperative: "cooperative",
} as const;

export type TimeoutStrategy = (typeof TimeoutStrategy)[keyof typeof TimeoutStrategy];

export interface ITimeoutOptions {
  readonly strategy?: TimeoutStrategy;
  /** Injected so a test need not spend the deadline. */
  readonly timer?: ITimer;
}

/** `reason` as something throwable, whatever the aborter supplied. */
function abortReason(reason: unknown): Error {
  return reason instanceof Error ? reason : new TaskCancelledError("The work was cancelled.");
}

/** Nothing to unlink; returned where a caller expects an unsubscribe. */
function noop(): void {
  // deliberately empty
}

/**
 * Observe a promise whose result nobody will read.
 *
 * The loser of an aggressive race still settles, and an unobserved rejection
 * would be reported as unhandled even though the race already answered.
 */
async function swallow(work: Promise<unknown>): Promise<void> {
  try {
    await work;
  } catch {
    // The race reported this already, or decided it no longer matters.
  }
}

export class TimeoutPolicy extends PolicyBase<IDefaultPolicyContext> {
  /** Fired when the deadline passes, whether or not the work notices. */
  readonly onTimeout: Event<void>;

  private readonly timeouts = new EventPublisher<void>();
  private readonly strategy: TimeoutStrategy;

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

  /** A promise that only ever rejects, once `signal` says so. */
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

  /** Run the work under `signal`, racing the deadline when told to. */
  private async run<T>(
    operation: (context: IDefaultPolicyContext) => PromiseLike<T> | T,
    signal: AbortSignal,
  ): Promise<T> {
    const work = Promise.resolve(operation({ signal }));
    if (this.strategy === TimeoutStrategy.Cooperative) return work;
    void swallow(work);
    return Promise.race([work, TimeoutPolicy.rejectWhenAborted<T>(signal)]);
  }

  /** Make the caller's cancellation cancel ours too; the result unlinks. */
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
