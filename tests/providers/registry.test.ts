/**
 * The one registry every kind of provider shares: what a name selects, what
 * order a listing comes back in, what a wrong name is told, and that
 * "select by name, then build" is one call.
 */

import { describe, expect, it } from "bun:test";

import { ValueError } from "../../src/core/util/errors";
import { Provider } from "../../src/providers/provider";
import { ProviderRegistry } from "../../src/providers/registry";

/** A provider that builds a string from a prefix, enough to see `create` work. */
class Stamp extends Provider<string, string> {
  constructor(
    readonly name: string,
    readonly description: string,
  ) {
    super();
  }

  create(prefix: string): string {
    return `${prefix}:${this.name}`;
  }
}

const stamp = (name: string, description = `the ${name} one`): Stamp =>
  new Stamp(name, description);

const formats = (...providers: Stamp[]) => new ProviderRegistry("report format", providers);

describe("the provider registry", () => {
  it("lists names in registration order, so the first is the default", () => {
    expect(formats(stamp("text"), stamp("ndjson"), stamp("github")).names()).toEqual([
      "text",
      "ndjson",
      "github",
    ]);
  });

  it("names the default: the first registered, and none when nothing is", () => {
    expect(formats(stamp("text"), stamp("ndjson")).defaultName()).toBe("text");
    expect(() => formats().defaultName()).toThrow(ValueError);
    expect(() => formats().defaultName()).toThrow("No report format is registered.");
  });

  it("sorts names for a message that reads the same every time", () => {
    expect(formats(stamp("text"), stamp("ndjson"), stamp("github")).sortedNames()).toEqual([
      "github",
      "ndjson",
      "text",
    ]);
  });

  it("selects by name and knows which names exist", () => {
    const registry = formats(stamp("text"), stamp("ndjson"));
    expect(registry.get("ndjson").description).toBe("the ndjson one");
    expect(registry.has("ndjson")).toBe(true);
    expect(registry.has("xml")).toBe(false);
  });

  it("refuses an unknown name with the registry's own noun and the alternatives", () => {
    const registry = formats(stamp("text"), stamp("github"));
    expect(() => registry.get("xml")).toThrow(ValueError);
    expect(() => registry.get("xml")).toThrow(
      "Unknown report format 'xml'; available: ['github', 'text']",
    );
  });

  it("names the thing it registers, so each flag's refusal reads like that flag", () => {
    expect(() => new ProviderRegistry("LLM provider", [stamp("local")]).get("gemini")).toThrow(
      "Unknown LLM provider 'gemini'; available: ['local']",
    );
  });

  it("builds through the named provider, and refuses the same way when it cannot", () => {
    const registry = formats(stamp("text"), stamp("ndjson"));
    expect(registry.create("ndjson", "run")).toBe("run:ndjson");
    expect(() => registry.create("xml", "run")).toThrow(
      "Unknown report format 'xml'; available: ['ndjson', 'text']",
    );
  });

  it("lets a later registration replace an earlier one, keeping its position", () => {
    const registry = formats(stamp("text"), stamp("ndjson"));
    registry.register(stamp("text", "replaced"));
    expect(registry.names()).toEqual(["text", "ndjson"]);
    expect(registry.get("text").description).toBe("replaced");
  });

  it("generates help text from what the providers say about themselves", () => {
    expect(formats(stamp("text"), stamp("ndjson")).describe()).toBe(
      "'text' the text one; 'ndjson' the ndjson one",
    );
  });

  it("describes nothing when nothing is registered", () => {
    expect(formats().describe()).toBe("");
    expect(formats().names()).toEqual([]);
  });
});
