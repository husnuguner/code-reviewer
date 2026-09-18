/**
 * The option parsers every command composes its flags from: what each
 * accepts, what it hands back, and how it refuses.
 */

import { describe, expect, it } from "bun:test";

import { InvalidArgumentError } from "commander";

import { choice, integer, listOf } from "../../src/cli/command-line";

describe("choice", () => {
  const format = choice(["text", "ndjson", "github"]);

  it("hands back exactly one of the listed values", () => {
    expect(format("ndjson")).toBe("ndjson");
  });

  it("refuses anything else, naming what it would have taken", () => {
    expect(() => format("xml")).toThrow(InvalidArgumentError);
    expect(() => format("xml")).toThrow("Allowed choices are text, ndjson, github.");
    // Case matters unless it was told not to.
    expect(() => format("NDJSON")).toThrow(InvalidArgumentError);
  });

  it("can forgive case and space, and then answers with the canonical spelling", () => {
    const severity = choice(["bug", "security"], { label: "severities", caseInsensitive: true });
    expect(severity(" Security ")).toBe("security");
    expect(() => severity("blocker")).toThrow("Allowed severities are bug, security.");
  });
});

describe("integer", () => {
  it("reads a whole number", () => {
    expect(integer("7")).toBe(7);
    expect(integer("0")).toBe(0);
  });

  it("refuses anything that is not one", () => {
    for (const text of ["seven", "-1", "1.5", "", " 7"]) {
      expect(() => integer(text)).toThrow(InvalidArgumentError);
    }
  });
});

describe("listOf", () => {
  const numbers = listOf(integer);

  it("parses each item on its own and keeps their order", () => {
    expect(numbers("3,1,2")).toEqual([3, 1, 2]);
  });

  it("drops blank entries and trims the rest", () => {
    expect(numbers(" 3 , ,1,")).toEqual([3, 1]);
    expect(numbers("")).toEqual([]);
  });

  it("takes another separator when told", () => {
    expect(listOf(integer, { separator: ";" })("1;2")).toEqual([1, 2]);
  });

  it("lets one item's refusal through as the list's", () => {
    expect(() => numbers("1,two")).toThrow("Not a whole number.");
  });

  describe("with a word for the empty list", () => {
    const gate = listOf(choice(["bug", "security"], { label: "severities" }), { none: "none" });

    it("reads that word, on its own, as no items", () => {
      expect(gate("none")).toEqual([]);
    });

    it("does not read it as an item among others", () => {
      expect(() => gate("bug,none")).toThrow(InvalidArgumentError);
    });

    it("names the word alongside the values when refusing", () => {
      expect(() => gate("blocker")).toThrow("Allowed severities are bug, security, or none.");
    });
  });
});
