/**
 * The retry loop: what it repeats, what it refuses to, and what comes out.
 *
 * Nothing here waits. The timer is injected, so a schedule that would take
 * twenty seconds runs in the millisecond the assertions need, and the waits
 * are asserted rather than spent.
 */

import { describe, expect, it } from "bun:test";

import {
  ConstantBackoff,
  FailureHandler,
  type IRetryEvent,
  type ITimer,
  PolicyError,
  RetryPolicy,
  retry,
} from "../index";

/** A clock that records the waits and advances by them instead of taking them. */
function recordingTimer(waits: number[]): ITimer {
  let clock = 0;
  return {
    now: () => clock,
    sleep: (ms) => {
      waits.push(ms);
      clock += ms;
      return Promise.resolve();
    },
  };
}

/** An operation that fails `failures` times and then answers `"ok"`. */
function failsThenSucceeds(failures: number, error: unknown = new Error("boom")) {
  let calls = 0;
  // An `async` body rather than `Promise.reject`: one case below fails with a
  // bare string, which a real callee can throw but a rejection may not spell.
  const operation = async (): Promise<string> => {
    calls++;
    if (calls <= failures) throw error;
    return "ok";
  };
  return { operation, calls: () => calls };
}

/** Whatever `run` threw, as a value to assert on rather than to match. */
async function thrownBy(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error("expected a rejection, got a value");
}

describe("the loop", () => {
  it("returns the first success without waiting", async () => {
    const waits: number[] = [];
    const { operation, calls } = failsThenSucceeds(0);
    const policy = retry(FailureHandler.all, { maxAttempts: 3, timer: recordingTimer(waits) });
    await expect(policy.execute(operation)).resolves.toBe("ok");
    expect(calls()).toBe(1);
    expect(waits).toEqual([]);
  });

  it("retries until it succeeds, waiting what the backoff said", async () => {
    const waits: number[] = [];
    const { operation, calls } = failsThenSucceeds(2);
    const policy = retry(FailureHandler.all, {
      maxAttempts: 3,
      backoff: new ConstantBackoff(100),
      timer: recordingTimer(waits),
    });
    await expect(policy.execute(operation)).resolves.toBe("ok");
    expect(calls()).toBe(3);
    expect(waits).toEqual([100, 100]);
  });

  it("counts the first call among the attempts, so 3 means two retries", async () => {
    const { operation, calls } = failsThenSucceeds(99);
    const policy = retry(FailureHandler.all, { maxAttempts: 3, timer: recordingTimer([]) });
    await expect(policy.execute(operation)).rejects.toThrow("boom");
    expect(calls()).toBe(3);
  });

  it("disables retrying at one attempt", async () => {
    const { operation, calls } = failsThenSucceeds(99);
    await expect(retry(FailureHandler.all, { maxAttempts: 1 }).execute(operation)).rejects.toThrow(
      "boom",
    );
    expect(calls()).toBe(1);
  });

  it("tells the function which attempt it is making", async () => {
    const seen: number[] = [];
    const policy = retry(FailureHandler.all, { maxAttempts: 3, timer: recordingTimer([]) });
    await policy.execute(({ attempt }) => {
      seen.push(attempt);
      if (attempt < 3) throw new Error("again");
      return "done";
    });
    expect(seen).toEqual([1, 2, 3]);
  });

  it("refuses an attempt count that is not a positive whole number", () => {
    for (const maxAttempts of [0, -1, 1.5]) {
      expect(() => new RetryPolicy(FailureHandler.all, { maxAttempts })).toThrow(PolicyError);
    }
  });
});

describe("what the handler claims, and what it does not", () => {
  it("leaves an unclaimed error alone, without retrying it", async () => {
    class Refusal extends Error {
      override readonly name = "Refusal";
    }
    const { operation, calls } = failsThenSucceeds(99, new Refusal("no"));
    const policy = retry(FailureHandler.ofType(TypeError), { maxAttempts: 3 });
    await expect(policy.execute(operation)).rejects.toBeInstanceOf(Refusal);
    // Not retried, and not swallowed: the handler never claimed it.
    expect(calls()).toBe(1);
  });

  it("retries a returned value the handler calls a failure", async () => {
    let calls = 0;
    const policy = retry(
      FailureHandler.whenResult((value) => value === "busy"),
      { maxAttempts: 3, timer: recordingTimer([]) },
    );
    const result = await policy.execute(() => {
      calls++;
      return calls < 3 ? "busy" : "ready";
    });
    expect({ result, calls }).toEqual({ result: "ready", calls: 3 });
  });

  it("returns the bad value, rather than throwing, when the attempts run out", async () => {
    // The reason there is no sentinel exception anywhere in the HTTP layer: a
    // 503 that survives every attempt comes back as the response it is.
    const policy = retry(
      FailureHandler.whenResult((value) => value === "busy"),
      { maxAttempts: 2, timer: recordingTimer([]) },
    );
    await expect(policy.execute(() => "busy")).resolves.toBe("busy");
  });
});

describe("the budget", () => {
  it("stops before a wait that would end past it, rather than after", async () => {
    const waits: number[] = [];
    const { operation, calls } = failsThenSucceeds(99);
    const policy = retry(FailureHandler.all, {
      maxAttempts: 10,
      backoff: new ConstantBackoff(400),
      maxDuration: 1000,
      timer: recordingTimer(waits),
    });
    await expect(policy.execute(operation)).rejects.toThrow("boom");
    // 400 + 400 fits in 1000; a third would reach 1200, so it is never taken
    // and the failure surfaces at once instead of a second later.
    expect(waits).toEqual([400, 400]);
    expect(calls()).toBe(3);
  });
});

describe("cancellation", () => {
  it("makes no attempt beyond the one running when the caller aborts", async () => {
    const controller = new AbortController();
    const { operation, calls } = failsThenSucceeds(99);
    const policy = retry(FailureHandler.all, {
      maxAttempts: 5,
      timer: {
        now: () => 0,
        // A timer that resolves rather than rejecting on abort: the policy
        // must still notice, which is why it asks again after the wait.
        sleep: () => {
          controller.abort();
          return Promise.resolve();
        },
      },
    });
    await expect(policy.execute(operation, controller.signal)).rejects.toThrow("boom");
    expect(calls()).toBe(1);
  });

  it("ends immediately when the caller had already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const { operation, calls } = failsThenSucceeds(99);
    await expect(
      retry(FailureHandler.all, { maxAttempts: 5 }).execute(operation, controller.signal),
    ).rejects.toThrow("boom");
    expect(calls()).toBe(1);
  });
});

describe("what it tells the listeners", () => {
  it("reports each retried attempt before the wait it causes", async () => {
    const seen: IRetryEvent[] = [];
    const { operation } = failsThenSucceeds(2);
    const policy = retry(FailureHandler.all, {
      maxAttempts: 3,
      backoff: new ConstantBackoff(50),
      timer: recordingTimer([]),
    });
    policy.onRetry((event) => void seen.push(event));
    await policy.execute(operation);
    expect(seen.map((event) => ({ attempt: event.attempt, delayMs: event.delayMs }))).toEqual([
      { attempt: 1, delayMs: 50 },
      { attempt: 2, delayMs: 50 },
    ]);
  });

  it("says nothing about an attempt it is not going to retry", async () => {
    const seen: IRetryEvent[] = [];
    const { operation } = failsThenSucceeds(99);
    const policy = retry(FailureHandler.all, { maxAttempts: 2, timer: recordingTimer([]) });
    policy.onRetry((event) => void seen.push(event));
    await expect(policy.execute(operation)).rejects.toThrow("boom");
    // Two attempts, one retry: the second failure is the answer, not a retry.
    expect(seen).toHaveLength(1);
  });

  it("announces giving up once, with the tally", async () => {
    const attempts: number[] = [];
    const { operation } = failsThenSucceeds(99);
    const policy = retry(FailureHandler.all, { maxAttempts: 3, timer: recordingTimer([]) });
    policy.onGiveUp((event) => void attempts.push(event.attempts));
    await expect(policy.execute(operation)).rejects.toThrow("boom");
    expect(attempts).toEqual([3]);
  });

  it("reports success once, however many attempts it took", async () => {
    let successes = 0;
    const { operation } = failsThenSucceeds(2);
    const policy = retry(FailureHandler.all, { maxAttempts: 3, timer: recordingTimer([]) });
    policy.onSuccess(() => {
      successes++;
    });
    await policy.execute(operation);
    expect(successes).toBe(1);
  });

  it("stops telling a listener that has unsubscribed", async () => {
    const seen: IRetryEvent[] = [];
    const { operation } = failsThenSucceeds(99);
    const policy = retry(FailureHandler.all, { maxAttempts: 3, timer: recordingTimer([]) });
    policy.onRetry((event) => void seen.push(event)).dispose();
    await expect(policy.execute(operation)).rejects.toThrow("boom");
    expect(seen).toEqual([]);
  });
});

describe("the error that comes out", () => {
  class Refusal extends Error {
    override readonly name = "Refusal";
    constructor(readonly status: number) {
      super(`refused with ${String(status)}`);
    }
  }

  it("is the one that was thrown, unwrapped, so `instanceof` still answers", async () => {
    const thrown = new Refusal(503);
    const { operation } = failsThenSucceeds(99, thrown);
    const policy = retry(FailureHandler.all, { maxAttempts: 3, timer: recordingTimer([]) });
    const caught = await thrownBy(() => policy.execute(operation));
    expect(caught).toBe(thrown);
    expect(caught).toBeInstanceOf(Refusal);
  });

  it("survives a rejection that is not an Error at all", async () => {
    const { operation } = failsThenSucceeds(99, "just a string");
    await expect(
      retry(FailureHandler.all, { maxAttempts: 2, timer: recordingTimer([]) }).execute(operation),
    ).rejects.toBe("just a string");
  });
});
