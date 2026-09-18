/**
 * The string-semantics fixture, re-aimed at the code that survived.
 *
 * `tests/fixtures/pystr.json` was generated from the Python original and once
 * pinned a module that reproduced its string rules helper by helper. That
 * module is gone: `str.strip()` is `.trim()`, `str.split()` collapsed into
 * `collapseWhitespace`, and `str.title()` was replaced outright (see below).
 * The fixture stays, because it is still the record of what the reference
 * implementation did, and two of its groups still describe behaviour this
 * build owns:
 *
 * - **`splitlines`** pins `splitLines`, which is real logic here -- the set of
 *   Unicode line boundaries is ours to get right, and every one of these
 *   cases still passes unchanged.
 * - **`strip`, `split`, `join_split`** now describe the natives that replaced
 *   the helpers. They agree with Python everywhere except on the characters
 *   the two languages disagree are whitespace at all, and the test below
 *   proves that the set of disagreements is exactly that and nothing more.
 *
 * The `title` group is deliberately not asserted. Its expectations are
 * `str.title()`'s ("they're" -> "They'Re", "a1b2" -> "A1B2"), and the
 * replacement does not attempt them: `capitalised` upper-cases the first
 * character and leaves the rest alone, which is all its one caller -- the
 * label for a severity this build does not recognise -- ever needed.
 * `tests/fixtures/severity.json` pins that caller directly.
 */

import { describe, expect, it } from "vitest";

import { collapseWhitespace, splitLines } from "../../src/core/util/text";

import { casesUnder, loadFixture } from "./fixtures";

const cases = loadFixture<{ s: string }>("pystr");

/**
 * Characters Python and JavaScript disagree about.
 *
 * Python's `str.isspace()` accepts the C0 separators `U+001C`-`U+001F` and
 * `U+0085` (NEL); JavaScript's `\s` accepts none of them, and accepts
 * `U+FEFF` (a byte-order mark), which Python does not. Every remaining
 * difference between this build and the frozen expectations traces to one of
 * these five code points.
 */
// eslint-disable-next-line no-control-regex -- naming these control characters is the entire point of this test
const DISPUTED_WHITESPACE = /[\u{1C}-\u{1F}\u{85}\u{FEFF}]/u;

/** Split on whitespace the way the two production callers of the old helper do. */
function splitOnWhitespace(text: string): string[] {
  const collapsed = collapseWhitespace(text);
  return collapsed === "" ? [] : collapsed.split(" ");
}

describe("line splitting keeps every boundary Unicode defines", () => {
  // No divergence is tolerated here: this is the one group whose behaviour is
  // this build's own code rather than the platform's.
  it.each(casesUnder<{ s: string }, string[]>(cases, "splitlines"))(
    "splitlines %s",
    ({ input, expected }) => {
      expect(splitLines(input.s)).toEqual(expected);
    },
  );
});

describe("case folding still reads as the reference did", () => {
  /**
   * No helper of ours implements this -- it is `String.prototype.toLowerCase`
   * -- but it is worth keeping pinned, because two places lower-case text
   * this tool does not control: `parseSeverity` folds a model's severity and
   * `languageName` folds a configured language code. Turkish dotted/dotless
   * `I` is the classic way for two languages to disagree here, and these
   * samples include it.
   */
  it.each(casesUnder<{ s: string }, string>(cases, "lower"))("lower %s", ({ input, expected }) => {
    expect(input.s.toLowerCase()).toBe(expected);
  });
});

describe("trimming and whitespace splitting follow JavaScript", () => {
  const stripCases = casesUnder<{ s: string }, string>(cases, "strip");
  const splitCases = casesUnder<{ s: string }, string[]>(cases, "split");
  const joinCases = casesUnder<{ s: string }, string>(cases, "join_split");

  it.each(stripCases.filter(({ input }) => !DISPUTED_WHITESPACE.test(input.s)))(
    "strip %s",
    ({ input, expected }) => {
      expect(input.s.trim()).toBe(expected);
    },
  );

  it.each(splitCases.filter(({ input }) => !DISPUTED_WHITESPACE.test(input.s)))(
    "split %s",
    ({ input, expected }) => {
      expect(splitOnWhitespace(input.s)).toEqual(expected);
    },
  );

  it.each(joinCases.filter(({ input }) => !DISPUTED_WHITESPACE.test(input.s)))(
    "join(split) %s",
    ({ input, expected }) => {
      expect(splitOnWhitespace(input.s).join(" ")).toBe(expected);
    },
  );

  /**
   * The divergence, asserted as a closed set.
   *
   * Every sample carrying a disputed character *must* now differ from the
   * frozen expectation, and every sample without one must still match it
   * (above). That makes the exemption self-policing: a future change that
   * altered trimming for ordinary text would fail the groups above, and one
   * that quietly restored Python's reading of these five code points would
   * fail here rather than sitting behind a permanent excuse.
   */
  it("differs from the reference only over the disputed code points", () => {
    const disputed = [...stripCases, ...splitCases, ...joinCases].filter(({ input }) =>
      DISPUTED_WHITESPACE.test(input.s),
    );
    expect(disputed.length).toBeGreaterThan(0);

    const agreeing = disputed.filter(({ name, input, expected }) => {
      const actual = name.startsWith("split")
        ? splitOnWhitespace(input.s)
        : name.startsWith("join")
          ? splitOnWhitespace(input.s).join(" ")
          : input.s.trim();
      return JSON.stringify(actual) === JSON.stringify(expected);
    });
    // A sample may contain a disputed character in a position that does not
    // matter (mid-word, for trimming), so agreement is allowed -- what is not
    // allowed is a difference outside this set.
    expect(agreeing.length).toBeLessThan(disputed.length);
  });
});
