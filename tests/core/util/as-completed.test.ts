/**
 * The completion-order primitive the review loop is built on.
 *
 * `iterBranchReview` hands every file's review to this helper at once and
 * emits each file's findings the moment that file is done. Two properties
 * make that safe, and both are invisible in the happy path:
 *
 * 1. a failure arrives as a *value*, so one file's bad model call cannot
 *    abandon the other files' findings, and
 * 2. every promise is observed the instant it is handed over, so a rejection
 *    that lands while the consumer is busy elsewhere does not become an
 *    unhandled rejection and kill the process.
 *
 * The second one is why this file exists. It held only by accident before --
 * the helper was an `async function*`, whose body does not run until the
 * first `next()` -- so a consumer that paused between building the generator
 * and iterating it crashed. Nothing caught that, because nothing tested it.
 */

import { describe, expect, it } from "vitest";

import { asCompleted } from "../../../src/core/util/as-completed";

/** A promise that settles after `ms`, so completion order can be arranged. */
function after<T>(ms: number, value: T): Promise<T> {
  return new Promise((resolve) =>
    setTimeout(() => {
      resolve(value);
    }, ms),
  );
}

/** A promise that rejects after `ms`. */
function failsAfter(ms: number, message: string): Promise<never> {
  return new Promise((_resolve, reject) =>
    setTimeout(() => {
      reject(new Error(message));
    }, ms),
  );
}

/** Every outcome, collected in the order it was yielded. */
async function collect<T>(promises: readonly Promise<T>[]): Promise<(T | string)[]> {
  const seen: (T | string)[] = [];
  for await (const outcome of asCompleted(promises)) {
    seen.push(outcome.ok ? outcome.value : `error: ${(outcome.error as Error).message}`);
  }
  return seen;
}

/**
 * Run `body` with an `unhandledRejection` listener installed, and report
 * whatever the process was told about.
 *
 * Vitest does not fail a test for an unhandled rejection that happens inside
 * it, so the only way to assert the absence of one is to listen for it.
 */
async function unhandledDuring(body: () => Promise<void>): Promise<string[]> {
  const seen: string[] = [];
  const listener = (reason: unknown): void => {
    seen.push(String(reason));
  };
  // Node's own handler would print and (under some flags) exit; ours replaces
  // it for the duration and is removed even if the body throws.
  process.on("unhandledRejection", listener);
  try {
    await body();
    // An unhandled rejection is reported a macrotask after the fact, so the
    // check has to outlive the body.
    await after(20, null);
  } finally {
    process.off("unhandledRejection", listener);
  }
  return seen;
}

describe("yielding in completion order", () => {
  it("yields the soonest first, not the order handed in", async () => {
    expect(await collect([after(30, "slow"), after(5, "quick"), after(15, "middling")])).toEqual([
      "quick",
      "middling",
      "slow",
    ]);
  });

  it("yields every promise exactly once", async () => {
    const seen = await collect([after(5, "a"), after(5, "b"), after(5, "c")]);
    expect(seen).toHaveLength(3);
    expect(new Set(seen)).toEqual(new Set(["a", "b", "c"]));
  });

  it("yields nothing for an empty batch, rather than hanging", async () => {
    expect(await collect([])).toEqual([]);
  });

  it("keeps duplicate values distinct, since each slot settles on its own", async () => {
    // Two promises resolving to the same value are two outcomes, not one:
    // the helper tracks slots, not values.
    expect(await collect([after(5, "same"), after(10, "same")])).toEqual(["same", "same"]);
  });
});

describe("a failure is a value, not a throw", () => {
  it("reports a rejection as ok:false and keeps going", async () => {
    // The whole point: one file's failed review must not cost the others
    // their findings.
    expect(await collect([failsAfter(5, "boom"), after(10, "survivor")])).toEqual([
      "error: boom",
      "survivor",
    ]);
  });

  it("survives a batch where everything fails", async () => {
    expect(await collect([failsAfter(5, "one"), failsAfter(10, "two")])).toEqual([
      "error: one",
      "error: two",
    ]);
  });

  it("carries a non-Error rejection through untouched", async () => {
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- a bare string is exactly the case under test
    const outcomes = asCompleted([Promise.reject("a bare string")]);
    // Stepped by hand rather than collected: it also pins that the generator
    // finishes once every slot has been yielded.
    const first = await outcomes.next();
    expect(first.value).toEqual({ ok: false, error: "a bare string" });
    const afterLast = await outcomes.next();
    expect(afterLast.done).toBe(true);
  });
});

describe("observing every promise immediately", () => {
  it("does not leave a rejection unhandled while the consumer is elsewhere", async () => {
    // The regression this file was written for. Building the generator must
    // already have attached to the promises; if attachment waited for the
    // first `next()`, the 50ms below is where the process would learn about
    // `early` with nobody listening.
    let seen: boolean[] = [];
    const unhandled = await unhandledDuring(async () => {
      const outcomes = asCompleted([Promise.reject(new Error("early")), Promise.resolve("fine")]);
      await after(50, null);
      seen = [];
      for await (const outcome of outcomes) seen.push(outcome.ok);
    });

    expect(unhandled).toEqual([]);
    // And the rejection is still delivered afterwards -- observed, not swallowed.
    expect(seen).toContain(false);
    expect(seen).toContain(true);
  });

  it("does not leave a rejection unhandled when the batch is abandoned early", async () => {
    // A consumer that breaks out of the loop (or throws) stops asking for
    // outcomes, but the promises it never collected have already settled.
    // They must stay observed.
    const unhandled = await unhandledDuring(async () => {
      const batch = [after(5, "first"), failsAfter(10, "never collected")];
      for await (const outcome of asCompleted(batch)) {
        if (outcome.ok) break;
      }
    });

    expect(unhandled).toEqual([]);
  });
});
