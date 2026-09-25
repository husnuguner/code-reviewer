/**
 * Which language reads a file: the registry the composition root hands the core, and the built-in list.
 */

import { describe, expect, it } from "bun:test";

import { type LanguageSupport } from "../../../src/core/ports/language";
import { PLAIN_TEXT } from "../../../src/core/review/context/index";
import { ValueError } from "../../../src/core/util/errors";
import { BUILTIN_LANGUAGES, builtinLanguages } from "../../../src/providers/languages/builtin";
import { LanguageRegistry } from "../../../src/providers/languages/registry";

/** A language that reads the given extensions and nothing more. */
function language(id: string, extensions: string[]): LanguageSupport {
  return { ...PLAIN_TEXT, id, extensions };
}

describe("the language registry", () => {
  it("chooses by the file's extension, whatever its case", () => {
    const registry = new LanguageRegistry([language("py", ["py"])]);
    expect(registry.forPath("app/users/service.py").id).toBe("py");
    expect(registry.forPath("APP/X.PY").id).toBe("py");
  });

  it("answers a file no language claims with the plain-text null object, never nothing", () => {
    const registry = new LanguageRegistry([language("py", ["py"])]);
    expect(registry.forPath("README.md")).toBe(PLAIN_TEXT);
    expect(registry.forPath("Dockerfile")).toBe(PLAIN_TEXT);
    expect(registry.forPath(".env")).toBe(PLAIN_TEXT);
  });

  it("takes another fallback when asked", () => {
    const other = language("text", []);
    expect(new LanguageRegistry([], other).forPath("a.xyz")).toBe(other);
  });

  it("refuses two languages claiming one extension: which would read the file is an accident of order", () => {
    const registry = new LanguageRegistry([language("a", ["x"])]);
    expect(() => registry.register(language("b", ["X"]))).toThrow(ValueError);
    expect(() => registry.register(language("b", ["X"]))).toThrow(
      "The extension '.X' is claimed by both 'a' and 'b'.",
    );
  });

  it("lets a language with the same id replace the one before it, extensions and all", () => {
    const registry = new LanguageRegistry([language("a", ["x", "y"])]);
    registry.register(language("a", ["z"]));
    expect(registry.forPath("f.z").id).toBe("a");
    expect(registry.forPath("f.x")).toBe(PLAIN_TEXT);
    expect(registry.ids()).toEqual(["a"]);
  });
});

describe("the built-in languages", () => {
  it("are TypeScript/JavaScript today, read through one registry", () => {
    expect(BUILTIN_LANGUAGES.map((entry) => entry.id)).toEqual(["typescript"]);
    const registry = builtinLanguages();
    for (const path of ["a.ts", "a.tsx", "a.mts", "a.cts", "a.js", "a.jsx", "a.mjs", "a.cjs"]) {
      expect(registry.forPath(path).id).toBe("typescript");
    }
    expect(registry.forPath("a.py")).toBe(PLAIN_TEXT);
  });
});
