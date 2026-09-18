/**
 * The text primitives the whole program leans on.
 *
 * This module is the busiest in `core/`: display (`show`), trimming,
 * code-point measurement and deterministic ordering are called from config
 * parsing, the review pipeline, the reporters and every error message. A
 * change here is felt everywhere and almost nowhere loudly, which is why the
 * behaviour is pinned as a table rather than described in prose.
 *
 * `tests/fixtures/text.json` is that table: sixteen awkward strings -- blank,
 * padded, mixed newlines, exotic separators, a BOM, Turkish casing -- run
 * through six of these functions. The strings are inherited from the Python
 * implementation this tool was ported from, because they are genuinely good
 * at breaking string code; the expectations are not. Every one of them was
 * recorded from this build and says what this build does.
 */

import { describe, expect, it } from "vitest";

import {
  asText,
  capitalised,
  collapseWhitespace,
  compareCodePoints,
  countCodePoints,
  cutToLength,
  show,
  sortedByCodePoint,
  splitLines,
  trimSlashes,
} from "../../../src/core/util/text";
import { casesUnder, loadFixture } from "../../contracts/fixtures";

const cases = loadFixture<{ s: string }>("text");

/** `<` on strings is the UTF-16 comparison `.sort()` does by default. */
const byUtf16 = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

describe("splitting lines", () => {
  // Real logic, not a native: the set of boundaries Unicode defines is wider
  // than `\n`, and getting it wrong silently mis-anchors a quoted finding.
  it.each(casesUnder<{ s: string }, string[]>(cases, "splitLines"))(
    "$name",
    ({ input, expected }) => {
      expect(splitLines(input.s)).toEqual(expected);
    },
  );

  it("splits on every boundary and drops the trailing empty element", () => {
    expect(splitLines("a\nb")).toEqual(["a", "b"]);
    expect(splitLines("a\nb\n")).toEqual(["a", "b"]);
    expect(splitLines("a\r\nb")).toEqual(["a", "b"]);
    expect(splitLines("a\u{2028}b\u{2029}c\u{85}d\vе".replace("е", "e"))).toHaveLength(5);
    expect(splitLines("")).toEqual([]);
  });
});

describe("trimming and collapsing", () => {
  it.each(casesUnder<{ s: string }, string>(cases, "trim"))("$name", ({ input, expected }) => {
    expect(input.s.trim()).toBe(expected);
  });

  it.each(casesUnder<{ s: string }, string>(cases, "collapseWhitespace"))(
    "$name",
    ({ input, expected }) => {
      expect(collapseWhitespace(input.s)).toBe(expected);
    },
  );

  it("collapses any run of whitespace to one space, and empties to nothing", () => {
    expect(collapseWhitespace("  a \t\n  b  ")).toBe("a b");
    expect(collapseWhitespace(" ".repeat(3))).toBe("");
  });

  it("strips slashes from both ends of a path, leaving the inside alone", () => {
    expect(trimSlashes("/a/b/")).toBe("a/b");
    expect(trimSlashes("a/b")).toBe("a/b");
    expect(trimSlashes("///")).toBe("");
  });
});

describe("case folding", () => {
  it.each(casesUnder<{ s: string }, string>(cases, "toLowerCase"))(
    "$name",
    ({ input, expected }) => {
      // Pinned because two of this program's gates fold case before comparing
      // (`--fail-on`, `--request-changes-on`) and Turkish text reaches them.
      expect(input.s.toLowerCase()).toBe(expected);
    },
  );

  it.each(casesUnder<{ s: string }, string>(cases, "capitalised"))(
    "$name",
    ({ input, expected }) => {
      expect(capitalised(input.s)).toBe(expected);
    },
  );

  it("upper-cases the first character and leaves the rest as written", () => {
    // Deliberately not a title case: the one caller is the label for a
    // severity this build does not recognise, and re-casing the tail would
    // mangle text the model wrote.
    expect(capitalised("custom thing")).toBe("Custom thing");
    expect(capitalised("a1b2 c3")).toBe("A1b2 c3");
    expect(capitalised("")).toBe("");
  });
});

describe("measuring and cutting", () => {
  it.each(casesUnder<{ s: string }, number>(cases, "countCodePoints"))(
    "$name",
    ({ input, expected }) => {
      expect(countCodePoints(input.s)).toBe(expected);
    },
  );

  it("counts code points, not UTF-16 units", () => {
    expect(countCodePoints("🚀")).toBe(1);
    expect("🚀".length).toBe(2);
  });

  it("never cuts a surrogate pair in half", () => {
    // The regression this file was written for. The astral check had been
    // written as `/[\uD800-\uDFFF]/u`, which under the `u` flag can only
    // match a *lone* surrogate and so answered "no" for every emoji: both
    // functions silently fell back to UTF-16 units. `cutToLength("a🚀", 2)`
    // then returned `"a\uD83D"` -- half a rocket, in a prompt or a record,
    // which is exactly what this promises not to do.
    expect(cutToLength("a🚀", 2)).toBe("a🚀");
    expect(cutToLength("🚀🚀🚀", 2)).toBe("🚀🚀");
    for (const character of cutToLength("a🚀", 2)) {
      const point = character.codePointAt(0) ?? 0;
      expect(point < 0xd8_00 || point > 0xdf_ff).toBe(true);
    }
    expect(cutToLength("abc", 10)).toBe("abc");
    expect(cutToLength("abc", 0)).toBe("");
  });
});

describe("deterministic ordering", () => {
  it("orders by code point, so two runs of the same review sort alike", () => {
    expect(sortedByCodePoint(["b", "a", "C"])).toEqual(["C", "a", "b"]);
    expect(sortedByCodePoint(new Set(["b", "a"]))).toEqual(["a", "b"]);
  });

  it("puts an astral character after every character of the basic plane", () => {
    // The one case where the native ordering disagrees, and the whole reason
    // this helper outlived the shim it came from. U+1F680 is above U+E000,
    // but its first UTF-16 unit (0xD83D) is below it -- so sorting by unit
    // puts the emoji first and sorting by code point puts it last.
    expect(compareCodePoints("🚀", "\u{E000}")).toBe(1);
    expect(["🚀", "\u{E000}"].toSorted(byUtf16)).toEqual(["🚀", "\u{E000}"]);
    expect(sortedByCodePoint(["🚀", "\u{E000}"])).toEqual(["\u{E000}", "🚀"]);
  });

  it("answers 0 only for equal strings, and orders a prefix first", () => {
    expect(compareCodePoints("a", "a")).toBe(0);
    expect(compareCodePoints("ab", "abc")).toBe(-1);
    expect(compareCodePoints("abc", "ab")).toBe(1);
  });
});

describe("rendering a value for a human", () => {
  it("quotes a string the way an error message wants it", () => {
    expect(show("medusa")).toBe("'medusa'");
    // Switches quotes rather than escaping, so a path with an apostrophe
    // stays readable in the one line an operator gets.
    expect(show("o'brien")).toBe('"o\'brien"');
    expect(show('say "hi"')).toBe("'say \"hi\"'");
  });

  it("spells a list compactly, and the rest the JavaScript way", () => {
    // Lists are offered mid-sentence ("available: [...]"), where inspect's
    // debugger padding costs width for nothing.
    expect(show(["claude", "local"])).toBe("['claude', 'local']");
    expect(show(null)).toBe("null");
    expect(show(true)).toBe("true");
    expect(show(3)).toBe("3");
  });

  it("passes a string through asText and renders anything else", () => {
    // The distinction matters: `String({})` is "[object Object]", which is
    // what a model or a YAML file would be reduced to without this.
    expect(asText("already text")).toBe("already text");
    expect(asText(3)).toBe("3");
    expect(asText({ a: 1 })).toContain("a");
    expect(asText({ a: 1 })).not.toBe("[object Object]");
  });
});
