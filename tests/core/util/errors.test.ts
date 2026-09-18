/**
 * The small shared helper every layer leans on: one way to render an unknown
 * error.
 */

import { describe, expect, it } from "vitest";

import { errorMessage } from "../../../src/core/util/errors";

describe("errorMessage", () => {
  it("takes an Error's message", () => {
    expect(errorMessage(new TypeError("boom"))).toBe("boom");
  });

  it("passes a thrown string through", () => {
    expect(errorMessage("plain")).toBe("plain");
  });

  it("serialises plain data", () => {
    expect(errorMessage({ code: 7 })).toBe('{"code":7}');
    expect(errorMessage(42)).toBe("42");
    expect(errorMessage(null)).toBe("null");
  });

  it("names what cannot be serialised", () => {
    expect(errorMessage(undefined)).toBe("<undefined>");
    expect(errorMessage(Symbol("s"))).toBe("<symbol>");
    expect(errorMessage(() => 1)).toBe("<function>");
    const cyclic: Record<string, unknown> = {};
    cyclic["self"] = cyclic;
    expect(errorMessage(cyclic)).toBe("<unserialisable object>");
  });
});
