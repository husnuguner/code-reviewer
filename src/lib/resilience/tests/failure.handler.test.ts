/**
 * The rules about what counts as a fault.
 *
 * The one thing worth pinning here is that a handler is a *value*: composing
 * it returns a new one, so a handler shared between two policies cannot be
 * widened by either of them.
 */

import { describe, expect, it } from "bun:test";

import { FailureHandler } from "../index";

class NetworkError extends Error {
  override readonly name = "NetworkError";
}

class HttpError extends Error {
  override readonly name = "HttpError";
  constructor(readonly status: number) {
    super(`HTTP ${String(status)}`);
  }
}

describe("the two ends of the range", () => {
  it("handleAll claims every error and no value", () => {
    expect(FailureHandler.all.handlesError(new Error("x"))).toBe(true);
    expect(FailureHandler.all.handlesError("not even an error")).toBe(true);
    // A returned value is never a failure unless the caller says which ones
    // are: a policy that guessed would retry every successful call.
    expect(FailureHandler.all.handlesResult("anything")).toBe(false);
  });

  it("none claims nothing, which is what a limit-only policy needs", () => {
    expect(FailureHandler.none.handlesError(new Error("x"))).toBe(false);
    expect(FailureHandler.none.handlesResult("x")).toBe(false);
  });
});

describe("selecting by type", () => {
  it("claims the named class and leaves its siblings alone", () => {
    const handler = FailureHandler.ofType(NetworkError);
    expect(handler.handlesError(new NetworkError("down"))).toBe(true);
    expect(handler.handlesError(new HttpError(500))).toBe(false);
  });

  it("narrows further when given a filter", () => {
    const handler = FailureHandler.ofType(HttpError, (error) => error.status >= 500);
    expect(handler.handlesError(new HttpError(503))).toBe(true);
    expect(handler.handlesError(new HttpError(404))).toBe(false);
  });
});

describe("composing", () => {
  it("widens across types and predicates together", () => {
    const handler = FailureHandler.ofType(NetworkError)
      .orType(HttpError, (error) => error.status === 503)
      .orWhen((error) => error === "timeout");
    expect(handler.handlesError(new NetworkError("down"))).toBe(true);
    expect(handler.handlesError(new HttpError(503))).toBe(true);
    expect(handler.handlesError(new HttpError(404))).toBe(false);
    expect(handler.handlesError("timeout")).toBe(true);
  });

  it("keeps errors and results as separate questions", () => {
    const handler = FailureHandler.whenResult((value) => value === "busy").orWhen(
      (error) => error instanceof NetworkError,
    );
    expect(handler.handlesResult("busy")).toBe(true);
    expect(handler.handlesResult("ready")).toBe(false);
    expect(handler.handlesError(new NetworkError("down"))).toBe(true);
    // The result rule must not leak into the error rule: the string "busy"
    // being a bad *result* says nothing about it being thrown.
    expect(handler.handlesError("busy")).toBe(false);
  });

  it("leaves the handler it was built from untouched", () => {
    const narrow = FailureHandler.ofType(NetworkError);
    const wide = narrow.orType(HttpError);
    // Sharing one handler between two policies must not let either widen the
    // other; every `or*` is a new value.
    expect(wide.handlesError(new HttpError(500))).toBe(true);
    expect(narrow.handlesError(new HttpError(500))).toBe(false);
  });
});
