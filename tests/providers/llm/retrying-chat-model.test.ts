/**
 * The model decorator: what it repeats, what it refuses to, and what it says.
 *
 * No network and no waiting -- the inner model answers from a script and the
 * timer is injected. What is asserted is the policy, because the policy is
 * what used to be invisible: the SDK retried behind a constant nobody could
 * see, and a call that never answered was never abandoned at all.
 */

import { describe, expect, it } from "bun:test";

import { APICallError } from "ai";

import { type ChatMessage, type ChatModel } from "../../../src/core/ports/chat-model";
import { type ITimer } from "../../../src/lib/resilience/index";
import { RetryingChatModel } from "../../../src/providers/llm/retrying-chat-model";
import { recordingLogger } from "../../helpers/logging";

const MESSAGES: ChatMessage[] = [{ role: "user", content: "review this" }];

/** A clock that records the waits and advances by them instead of taking them. */
function recordingTimer(waits: number[] = []): ITimer {
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

/** A model that answers from `script`, repeating its last answer. */
function scripted(script: readonly (string | Error)[]) {
  let calls = 0;
  const signals: (AbortSignal | undefined)[] = [];
  const model: ChatModel = {
    // An `async` body: a scripted failure is thrown, as a real client throws.
    async generate(_messages, options = {}) {
      const answer = script[Math.min(calls, script.length - 1)];
      calls++;
      signals.push(options.signal);
      if (answer instanceof Error) throw answer;
      return { text: answer ?? "" };
    },
  };
  return { model, calls: () => calls, signals };
}

/** An `APICallError` as the AI SDK raises one. */
function apiError(statusCode: number, isRetryable: boolean): APICallError {
  return new APICallError({
    message: `HTTP ${String(statusCode)}`,
    url: "https://api.example.com/v1/chat",
    requestBodyValues: {},
    statusCode,
    isRetryable,
  });
}

describe("what it repeats", () => {
  it("returns the first answer without waiting", async () => {
    const waits: number[] = [];
    const inner = scripted(["done"]);
    const model = new RetryingChatModel(inner.model, { timer: recordingTimer(waits) });
    await expect(model.generate(MESSAGES)).resolves.toEqual({ text: "done" });
    expect({ calls: inner.calls(), waits }).toEqual({ calls: 1, waits: [] });
  });

  it("retries a failure the SDK itself calls retryable", async () => {
    const inner = scripted([apiError(429, true), "done"]);
    const model = new RetryingChatModel(inner.model, { timer: recordingTimer() });
    await expect(model.generate(MESSAGES)).resolves.toEqual({ text: "done" });
    expect(inner.calls()).toBe(2);
  });

  it("retries a transient status even when the SDK says otherwise", async () => {
    // The gateway case: an error that crossed a proxy can arrive with the
    // flag unset, which is precisely what the SDK's own retry skips.
    const inner = scripted([apiError(503, false), "done"]);
    const model = new RetryingChatModel(inner.model, { timer: recordingTimer() });
    await expect(model.generate(MESSAGES)).resolves.toEqual({ text: "done" });
    expect(inner.calls()).toBe(2);
  });

  it("retries a bare network failure, which is no APICallError at all", async () => {
    const inner = scripted([new TypeError("fetch failed"), "done"]);
    const model = new RetryingChatModel(inner.model, { timer: recordingTimer() });
    await expect(model.generate(MESSAGES)).resolves.toEqual({ text: "done" });
    expect(inner.calls()).toBe(2);
  });

  it("backs off further each time, with jitter", async () => {
    const waits: number[] = [];
    const inner = scripted([apiError(500, true), apiError(500, true), "done"]);
    const model = new RetryingChatModel(inner.model, {
      attempts: 3,
      baseDelayMs: 1000,
      random: () => 1,
      timer: recordingTimer(waits),
    });
    await model.generate(MESSAGES);
    expect(waits).toEqual([1000, 2000]);
  });
});

describe("what it refuses to repeat", () => {
  it("surrenders a refusal that a second call cannot change", async () => {
    const thrown = apiError(401, false);
    const inner = scripted([thrown]);
    const model = new RetryingChatModel(inner.model, { timer: recordingTimer() });
    await expect(model.generate(MESSAGES)).rejects.toBe(thrown);
    expect(inner.calls()).toBe(1);
  });

  it("gives up after the last attempt, with the error unwrapped", async () => {
    const thrown = apiError(503, true);
    const inner = scripted([thrown]);
    const model = new RetryingChatModel(inner.model, { attempts: 3, timer: recordingTimer() });
    // Unwrapped on purpose: the review layer reports `errorMessage(error)`,
    // and a wrapper would replace the vendor's sentence with our own.
    await expect(model.generate(MESSAGES)).rejects.toBe(thrown);
    expect(inner.calls()).toBe(3);
  });
});

describe("the deadline that did not exist before", () => {
  it("hands every attempt a signal, so a silent model cannot hold a slot", async () => {
    const inner = scripted(["done"]);
    await new RetryingChatModel(inner.model, { timer: recordingTimer() }).generate(MESSAGES);
    expect(inner.signals[0]).toBeInstanceOf(AbortSignal);
    expect(inner.signals[0]?.aborted).toBe(false);
  });

  it("abandons an attempt that never answers, and tries again", async () => {
    let calls = 0;
    const model: ChatModel = {
      async generate(_messages, options = {}) {
        calls++;
        if (calls > 1) return { text: "done" };
        await new Promise((resolve) => {
          options.signal?.addEventListener("abort", resolve, { once: true });
        });
        return { text: "too late" };
      },
    };
    const retrying = new RetryingChatModel(model, { timeoutMs: 5, timer: recordingTimer() });
    await expect(retrying.generate(MESSAGES)).resolves.toEqual({ text: "done" });
    expect(calls).toBe(2);
  });
});

describe("what it says while doing it", () => {
  it("names the status and the wait", async () => {
    const lines: string[] = [];
    const inner = scripted([apiError(429, true), "done"]);
    const model = new RetryingChatModel(inner.model, {
      baseDelayMs: 1000,
      random: () => 1,
      logger: recordingLogger(lines),
      timer: recordingTimer(),
    });
    await model.generate(MESSAGES);
    expect(lines).toEqual(["WARNING The model answered 429; retrying in 1000ms (attempt 2 of 3)."]);
  });

  it("says nothing at all when nothing had to be repeated", async () => {
    const lines: string[] = [];
    const inner = scripted(["done"]);
    await new RetryingChatModel(inner.model, {
      logger: recordingLogger(lines),
      timer: recordingTimer(),
    }).generate(MESSAGES);
    expect(lines).toEqual([]);
  });
});
