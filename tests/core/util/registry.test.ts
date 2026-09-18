/**
 * The one registry the three selectable things share: what a name selects,
 * what order a listing comes back in, and what a wrong name is told.
 */

import { describe, expect, it } from "bun:test";

import { ValueError } from "../../../src/core/util/errors";
import { DescribedRegistry, Registry } from "../../../src/core/util/registry";

interface Entry {
  readonly name: string;
  readonly description: string;
}

const entry = (name: string, description = `the ${name} one`): Entry => ({ name, description });

const described = (...entries: Entry[]) => new DescribedRegistry("report format", entries);

describe("the registry", () => {
  it("lists names in registration order, so the first is the default", () => {
    expect(described(entry("text"), entry("ndjson"), entry("github")).names()).toEqual([
      "text",
      "ndjson",
      "github",
    ]);
  });

  it("sorts names for a message that reads the same every time", () => {
    expect(described(entry("text"), entry("ndjson"), entry("github")).sortedNames()).toEqual([
      "github",
      "ndjson",
      "text",
    ]);
  });

  it("selects by name and knows which names exist", () => {
    const registry = described(entry("text"), entry("ndjson"));
    expect(registry.get("ndjson").description).toBe("the ndjson one");
    expect(registry.has("ndjson")).toBe(true);
    expect(registry.has("xml")).toBe(false);
  });

  it("refuses an unknown name with the registry's own noun and the alternatives", () => {
    const registry = described(entry("text"), entry("github"));
    expect(() => registry.get("xml")).toThrow(ValueError);
    expect(() => registry.get("xml")).toThrow(
      "Unknown report format 'xml'; available: ['github', 'text']",
    );
  });

  it("names the thing it registers, so each flag's refusal reads like that flag", () => {
    expect(() => new Registry("LLM provider", [entry("local")]).get("gemini")).toThrow(
      "Unknown LLM provider 'gemini'; available: ['local']",
    );
  });

  it("lets a later registration replace an earlier one, keeping its position", () => {
    const registry = described(entry("text"), entry("ndjson"));
    registry.register(entry("text", "replaced"));
    expect(registry.names()).toEqual(["text", "ndjson"]);
    expect(registry.get("text").description).toBe("replaced");
  });

  it("generates help text from what the entries say about themselves", () => {
    expect(described(entry("text"), entry("ndjson")).describe()).toBe(
      "'text' the text one; 'ndjson' the ndjson one",
    );
  });

  it("describes nothing when nothing is registered", () => {
    expect(described().describe()).toBe("");
    expect(described().names()).toEqual([]);
  });
});
