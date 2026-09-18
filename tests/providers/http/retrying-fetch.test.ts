/**
 * The transport decorator: which failures are worth asking about again.
 *
 * Nothing here waits and nothing here reaches the network -- `sleep` and
 * `random` are injected, and the transport is a function that answers from a
 * script. What is asserted is the policy, because the policy is the part that
 * can be wrong in a way nobody notices: a `502` repeated on a `POST` posts the
 * review twice, and a `429` not repeated loses it.
 */

import { describe, expect, it } from "bun:test";

import { type ITimer } from "../../../src/lib/resilience/index";
import { type FetchLike } from "../../../src/providers/http/fetch-like";
import { serverAskedForMs } from "../../../src/providers/http/retry-after-backoff";
import { withRetry } from "../../../src/providers/http/retrying-fetch";
import { recordingLogger } from "../../helpers/logging";

const URL_ = new URL("https://api.github.com/repos/a/b/pulls/1/reviews");

interface Recorder {
  readonly transport: FetchLike;
  readonly calls: () => number;
  readonly waits: number[];
}

/** A transport that answers from `script`, repeating its last answer. */
function scripted(script: readonly (Response | Error)[]): Recorder {
  const waits: number[] = [];
  let calls = 0;
  // An `async` body rather than `Promise.reject`: a scripted failure may be a
  // bare `TypeError`, which a real transport throws but a rejection may not
  // be spelled with.
  const transport: FetchLike = async () => {
    const answer = script[Math.min(calls, script.length - 1)];
    calls++;
    if (answer instanceof Error) throw answer;
    return answer ?? new Response("", { status: 200 });
  };
  return { transport, calls: () => calls, waits };
}

/**
 * A clock that records the waits and advances by them instead of taking them.
 *
 * Both halves together: the call's budget is the difference between two
 * readings of this clock, so faking the sleeping and not the time would
 * measure a budget nothing ever spends.
 */
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

/** `withRetry` with the waits recorded instead of taken. */
function wrap(
  recorder: Recorder,
  options: Parameters<typeof withRetry>[1] = {},
): ReturnType<typeof withRetry> {
  return withRetry(recorder.transport, {
    random: () => 1,
    timer: recordingTimer(recorder.waits),
    ...options,
  });
}

/** A response with headers, spelled once. */
function answer(status: number, headers: Record<string, string> = {}): Response {
  return new Response(`body-${String(status)}`, { status, headers });
}

/** A rejected `fetch`, as undici spells one. */
function networkError(code?: string): TypeError {
  return new TypeError("fetch failed", code === undefined ? undefined : { cause: { code } });
}

describe("an idempotent request", () => {
  it("is repeated for every transient status", async () => {
    for (const status of [408, 425, 429, 500, 502, 503, 504]) {
      const recorder = scripted([answer(status), answer(200)]);
      const response = await wrap(recorder)(URL_, { method: "GET" });
      expect({ status, calls: recorder.calls() }).toEqual({ status, calls: 2 });
      expect(response.status).toBe(200);
    }
  });

  it("is not repeated for a refusal a second attempt cannot change", async () => {
    for (const status of [400, 401, 403, 404, 410, 422, 451]) {
      const recorder = scripted([answer(status)]);
      const response = await wrap(recorder)(URL_, { method: "GET" });
      expect({ status, calls: recorder.calls() }).toEqual({ status, calls: 1 });
      expect(response.status).toBe(status);
    }
  });

  it("is repeated for a network failure of any kind", async () => {
    for (const code of ["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", undefined]) {
      const recorder = scripted([networkError(code), answer(200)]);
      await wrap(recorder)(URL_, { method: "GET" });
      expect({ code, calls: recorder.calls() }).toEqual({ code, calls: 2 });
    }
  });

  it("is repeated after an attempt that ran out of time", async () => {
    const timedOut = new DOMException("timed out", "TimeoutError");
    const recorder = scripted([timedOut, answer(200)]);
    await wrap(recorder)(URL_, { method: "GET" });
    expect(recorder.calls()).toBe(2);
  });

  it("is repeated after the policy's *own* deadline, not only a platform one", async () => {
    // The regression this pins: the per-attempt limit is imposed above the
    // transport, so a slow host surfaces as the timeout policy's own
    // `TaskCancelledError` and never as a `DOMException`. Classifying only
    // the platform spelling made a real timeout unretryable while a test
    // injecting `DOMException` went on passing.
    let calls = 0;
    const transport: FetchLike = async (_input, init) => {
      calls++;
      if (calls > 1) return answer(200);
      await new Promise((resolve) => {
        init.signal?.addEventListener("abort", resolve, { once: true });
      });
      return answer(500);
    };
    const response = await withRetry(transport, {
      timeoutMs: 5,
      timer: recordingTimer([]),
    })(URL_, { method: "GET" });
    expect({ calls, status: response.status }).toEqual({ calls: 2, status: 200 });
  });

  it("surrenders a POST to that same deadline, which proves nothing", async () => {
    let calls = 0;
    const transport: FetchLike = async (_input, init) => {
      calls++;
      await new Promise((resolve) => {
        init.signal?.addEventListener("abort", resolve, { once: true });
      });
      return answer(500);
    };
    const attempt = withRetry(transport, { timeoutMs: 5, timer: recordingTimer([]) })(URL_, {
      method: "POST",
    });
    await expect(attempt).rejects.toBeDefined();
    expect(calls).toBe(1);
  });
});

describe("a POST, which posting a review twice would be the cost of", () => {
  it("is repeated only for the statuses that are a refusal to process", async () => {
    for (const status of [429, 503]) {
      const recorder = scripted([answer(status), answer(200)]);
      await wrap(recorder)(URL_, { method: "POST" });
      expect({ status, calls: recorder.calls() }).toEqual({ status, calls: 2 });
    }
  });

  it("is surrendered on every status that might mean it was processed", async () => {
    // 502 and 504 are the ambiguous ones: the upstream may well have handled
    // the request and lost the answer. Repeating them is how a pull request
    // ends up with two identical reviews.
    for (const status of [408, 425, 500, 502, 504]) {
      const recorder = scripted([answer(status), answer(200)]);
      const response = await wrap(recorder)(URL_, { method: "POST" });
      expect({ status, calls: recorder.calls() }).toEqual({ status, calls: 1 });
      expect(response.status).toBe(status);
    }
  });

  it("is repeated only for network failures that predate a connection", async () => {
    for (const code of ["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED"]) {
      const recorder = scripted([networkError(code), answer(200)]);
      await wrap(recorder)(URL_, { method: "POST" });
      expect({ code, calls: recorder.calls() }).toEqual({ code, calls: 2 });
    }
  });

  it("is surrendered on a reset socket, which proves nothing either way", async () => {
    for (const code of ["ECONNRESET", "UND_ERR_SOCKET", undefined]) {
      const recorder = scripted([networkError(code), answer(200)]);
      const attempt = wrap(recorder)(URL_, { method: "POST" });
      await expect(attempt).rejects.toBeInstanceOf(TypeError);
      expect({ code, calls: recorder.calls() }).toEqual({ code, calls: 1 });
    }
  });

  it("is surrendered on a timeout, which is the same ambiguity", async () => {
    const recorder = scripted([new DOMException("timed out", "TimeoutError"), answer(200)]);
    await expect(wrap(recorder)(URL_, { method: "POST" })).rejects.toBeInstanceOf(DOMException);
    expect(recorder.calls()).toBe(1);
  });
});

describe("a rate limit, which GitHub spells two ways", () => {
  it("is recognised as a 403 that carries the rate-limit headers", async () => {
    const recorder = scripted([answer(403, { "x-ratelimit-remaining": "0" }), answer(200)]);
    await wrap(recorder)(URL_, { method: "POST" });
    expect(recorder.calls()).toBe(2);
  });

  it("is recognised as a 403 that carries Retry-After", async () => {
    const recorder = scripted([answer(403, { "retry-after": "1" }), answer(200)]);
    await wrap(recorder)(URL_, { method: "POST" });
    expect(recorder.calls()).toBe(2);
  });

  it("is not read into a plain 403, which is a token problem", async () => {
    const recorder = scripted([answer(403, { "x-ratelimit-remaining": "42" })]);
    const response = await wrap(recorder)(URL_, { method: "GET" });
    expect(recorder.calls()).toBe(1);
    expect(response.status).toBe(403);
  });
});

describe("how long the server said to wait", () => {
  const now = Date.UTC(2026, 0, 1, 12, 0, 0);

  it("reads Retry-After in seconds", () => {
    expect(serverAskedForMs(answer(503, { "retry-after": "7" }), now)).toBe(7000);
  });

  it("reads Retry-After as an HTTP date", () => {
    const later = new Date(now + 30_000).toUTCString();
    expect(serverAskedForMs(answer(503, { "retry-after": later }), now)).toBe(30_000);
  });

  it("reads a date already past as no wait at all", () => {
    const earlier = new Date(now - 30_000).toUTCString();
    expect(serverAskedForMs(answer(503, { "retry-after": earlier }), now)).toBe(0);
  });

  it("falls back to the backoff when the header is unreadable", () => {
    expect(serverAskedForMs(answer(503, { "retry-after": "soon" }), now)).toBeNull();
    expect(serverAskedForMs(answer(503, { "retry-after": "-5" }), now)).toBeNull();
    expect(serverAskedForMs(answer(503), now)).toBeNull();
  });

  it("reads x-ratelimit-reset, but only on a response that was a rate limit", () => {
    const reset = String(Math.floor(now / 1000) + 45);
    expect(serverAskedForMs(answer(429, { "x-ratelimit-reset": reset }), now)).toBe(45_000);
    // The same header on a 500 names a window that has nothing to do with
    // when this request might succeed.
    expect(serverAskedForMs(answer(500, { "x-ratelimit-reset": reset }), now)).toBeNull();
  });

  it("is obeyed instead of the backoff", async () => {
    const recorder = scripted([answer(503, { "retry-after": "3" }), answer(200)]);
    await wrap(recorder, { baseDelayMs: 500 })(URL_, { method: "GET" });
    expect(recorder.waits).toEqual([3000]);
  });

  it("is capped, so a server cannot park the run for an hour", async () => {
    const recorder = scripted([answer(503, { "retry-after": "3600" }), answer(200)]);
    await wrap(recorder, { maxDelayMs: 20_000 })(URL_, { method: "GET" });
    expect(recorder.waits).toEqual([20_000]);
  });
});

describe("the backoff, when the server said nothing", () => {
  it("doubles its window each attempt", async () => {
    const recorder = scripted([answer(503), answer(503), answer(200)]);
    await wrap(recorder, { attempts: 3, baseDelayMs: 500 })(URL_, { method: "GET" });
    // `random: () => 1` takes the top of each full-jitter window.
    expect(recorder.waits).toEqual([500, 1000]);
  });
});

describe("when the attempts run out", () => {
  it("returns the last response, with its body still there to be read", async () => {
    // Three distinct responses, as a real transport would produce: the point
    // is that the *last* one is untouched, not that discarding is skipped.
    const recorder = scripted([answer(503), answer(503), answer(503)]);
    const response = await wrap(recorder, { attempts: 3 })(URL_, { method: "GET" });
    expect(recorder.calls()).toBe(3);
    expect(response.status).toBe(503);
    // The client reads this body to say *which* comment GitHub disliked; a
    // decorator that consumed it would reduce every error to a status code.
    await expect(response.text()).resolves.toBe("body-503");
  });

  it("releases the responses it discarded on the way", async () => {
    const discarded = answer(503);
    const recorder = scripted([discarded, discarded, answer(200)]);
    await wrap(recorder, { attempts: 3 })(URL_, { method: "GET" });
    // An unread body keeps its connection checked out of the pool.
    expect(discarded.bodyUsed || discarded.body?.locked !== false).toBe(true);
  });

  it("rethrows the transport's own failure unwrapped", async () => {
    const thrown = networkError("ECONNRESET");
    const recorder = scripted([thrown]);
    let caught: unknown;
    try {
      await wrap(recorder)(URL_, { method: "GET" });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(thrown);
  });
});

describe("the budget", () => {
  it("stops before a wait that would end past the deadline", async () => {
    const recorder = scripted([answer(503, { "retry-after": "5" })]);
    const response = await wrap(recorder, { attempts: 5, maxDurationMs: 6000 })(URL_, {
      method: "GET",
    });
    // One 5s wait fits in 6s; the second would not, so the third attempt is
    // never made and the 503 is the answer.
    expect(recorder.calls()).toBe(2);
    expect(response.status).toBe(503);
  });

  it("tries three times by default, which is two retries", async () => {
    const recorder = scripted([answer(503)]);
    await wrap(recorder)(URL_, { method: "GET" });
    expect(recorder.calls()).toBe(3);
  });
});

describe("what it says while doing it", () => {
  it("names the method, the path, the reason and the wait", async () => {
    const lines: string[] = [];
    const recorder = scripted([answer(503), answer(200)]);
    await wrap(recorder, { logger: recordingLogger(lines), baseDelayMs: 500 })(URL_, {
      method: "GET",
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe(
      "WARNING GET /repos/a/b/pulls/1/reviews answered 503; retrying in 500ms (attempt 2 of 3).",
    );
  });

  it("names a network failure by its code rather than by its message", async () => {
    const lines: string[] = [];
    const recorder = scripted([networkError("ENOTFOUND"), answer(200)]);
    await wrap(recorder, { logger: recordingLogger(lines) })(URL_, { method: "GET" });
    expect(lines[0]).toContain("failed (ENOTFOUND)");
  });

  it("says nothing at all when nothing had to be repeated", async () => {
    const lines: string[] = [];
    const recorder = scripted([answer(200)]);
    await wrap(recorder, { logger: recordingLogger(lines) })(URL_, { method: "GET" });
    expect(lines).toEqual([]);
  });
});

describe("the caller's own cancellation", () => {
  it("ends the attempts rather than outliving them", async () => {
    const controller = new AbortController();
    const recorder = scripted([answer(503), answer(200)]);
    const retrying = withRetry(recorder.transport, {
      timer: {
        now: () => 0,
        sleep: () => {
          controller.abort();
          return Promise.resolve();
        },
      },
    });
    const response = await retrying(URL_, { method: "GET", signal: controller.signal });
    expect(recorder.calls()).toBe(1);
    expect(response.status).toBe(503);
  });
});

describe("the contract it keeps", () => {
  it("passes the method, body and headers through untouched", async () => {
    const seen: RequestInit[] = [];
    const transport: FetchLike = (_input, init) => {
      seen.push(init);
      return Promise.resolve(answer(200));
    };
    await withRetry(transport)(URL_, {
      method: "PUT",
      body: '{"a":1}',
      headers: { authorization: "Bearer t" },
    });
    expect(seen[0]?.method).toBe("PUT");
    expect(seen[0]?.body).toBe('{"a":1}');
    expect(seen[0]?.headers).toEqual({ authorization: "Bearer t" });
  });

  it("gives each attempt a signal, so no attempt can hang for ever", async () => {
    const seen: (AbortSignal | null | undefined)[] = [];
    const transport: FetchLike = (_input, init) => {
      seen.push(init.signal);
      return Promise.resolve(answer(200));
    };
    await withRetry(transport)(URL_, { method: "GET" });
    expect(seen[0]).toBeInstanceOf(AbortSignal);
  });

  it("treats a request with no method as the GET it is", async () => {
    const recorder = scripted([answer(500), answer(200)]);
    await wrap(recorder)(URL_, {});
    expect(recorder.calls()).toBe(2);
  });
});
