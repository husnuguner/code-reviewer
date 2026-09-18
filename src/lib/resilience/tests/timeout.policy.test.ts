/**
 * The deadline policy: a signal, and the patience to stop waiting.
 *
 * These tests use real (very short) timers, because what is being asserted is
 * the interaction with `AbortSignal` rather than any arithmetic.
 */

import { describe, expect, it } from "bun:test";

import { PolicyError, TaskCancelledError, TimeoutPolicy, TimeoutStrategy, timeout } from "../index";

/** Resolve after `ms`, ignoring any signal: a callee that does not cooperate. */
function stubborn(ms: number): Promise<string> {
  return new Promise((resolve) => {
    setTimeout(() => resolve("late"), ms);
  });
}

describe("the happy path", () => {
  it("returns the value and hands back a signal that was never aborted", async () => {
    const policy = timeout(1000);
    let seen: AbortSignal | undefined;
    const result = await policy.execute((context) => {
      seen = context.signal;
      return "done";
    });
    expect(result).toBe("done");
    expect(seen?.aborted).toBe(false);
  });

  it("clears its timer, so a fast success does not hold the process open", async () => {
    // A leaked `setTimeout` would keep Bun's event loop alive for the whole
    // duration; the test finishing promptly is the assertion.
    const started = Date.now();
    await timeout(30_000).execute(() => "done");
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe("when the deadline passes", () => {
  it("aborts the signal it gave the work", async () => {
    let seen: AbortSignal | undefined;
    const attempt = timeout(5).execute((context) => {
      seen = context.signal;
      return stubborn(200);
    });
    await expect(attempt).rejects.toBeInstanceOf(TaskCancelledError);
    expect(seen?.aborted).toBe(true);
  });

  it("stops waiting for a callee that ignores its signal", async () => {
    const started = Date.now();
    await expect(timeout(5).execute(() => stubborn(2000))).rejects.toBeInstanceOf(
      TaskCancelledError,
    );
    // Aggressive is the default precisely so this cannot take two seconds.
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("announces the timeout to whoever is listening", async () => {
    const policy = timeout(5);
    let fired = 0;
    policy.onTimeout(() => {
      fired++;
    });
    await expect(policy.execute(() => stubborn(200))).rejects.toBeInstanceOf(TaskCancelledError);
    expect(fired).toBe(1);
  });

  it("waits for a cooperative callee rather than abandoning it", async () => {
    const policy = timeout(5, { strategy: TimeoutStrategy.Cooperative });
    // Cooperative only signals; a callee that answers the signal decides what
    // the call returns, so this one is allowed to finish with a value.
    const result = await policy.execute(async (context) => {
      if (context.signal.aborted) return "aborted";
      await stubborn(20);
      return "finished";
    });
    expect(result).toBe("finished");
  });
});

describe("what it claims", () => {
  it("claims none of the work's own failures", async () => {
    class Refusal extends Error {
      override readonly name = "Refusal";
    }
    const thrown = new Refusal("no");
    // A limit is not a judgement: the error must arrive exactly as thrown.
    await expect(
      timeout(1000).execute(() => {
        throw thrown;
      }),
    ).rejects.toBe(thrown);
  });

  it("refuses a duration that is not a positive whole number", () => {
    for (const duration of [0, -1, 1.5]) {
      expect(() => new TimeoutPolicy(duration)).toThrow(PolicyError);
    }
  });
});

describe("the caller's own cancellation", () => {
  it("passes through to the work", async () => {
    const controller = new AbortController();
    controller.abort();
    let seen: AbortSignal | undefined;
    await expect(
      timeout(1000).execute((context) => {
        seen = context.signal;
        return stubborn(200);
      }, controller.signal),
    ).rejects.toBeDefined();
    expect(seen?.aborted).toBe(true);
  });
});
