/**
 * Text primitives this tool genuinely needs, named for what they do.
 *
 * This module replaces an earlier one that reproduced Python's string
 * semantics helper by helper, because the reviewer began life as a Python
 * program and its behavioural contract (`tests/fixtures/`) was frozen from
 * that original. Most of those helpers turned out to be Node's own behaviour
 * spelled out longhand -- `str.strip()` is `.trim()`, `repr()` is
 * `util.inspect`, `str.split()` is one regular expression -- so they are
 * gone, and the call sites say what they mean directly.
 *
 * What survives here is the handful of operations the platform does *not*
 * offer: code-point counting and cutting (the character budgets in this tool
 * are counted in code points, so a cap can never split an emoji in half),
 * line splitting over every boundary Unicode defines, and a deterministic
 * ordering that does not vary with locale.
 */

import { inspect } from "node:util";

/**
 * A value as a message shows it: strings quoted, everything else spelled the
 * way Node spells it.
 *
 * Every message that names a value goes through this, so a value's type and
 * boundaries are always visible -- `got: ''` and `got: 0` say something that
 * bare interpolation does not. `util.inspect` rather than a hand-written
 * quoter: it is the platform's own answer, it escapes what needs escaping,
 * and it switches to double quotes for text containing an apostrophe.
 *
 * The options are fixed here rather than at each call site. `breakLength`
 * matters: inspect wraps long output across lines by default, which would
 * turn a list of valid setting names into a multi-line error message and
 * make every message assertion whitespace-sensitive.
 *
 * A list is the one shape spelled by hand, compactly (`['a', 'b']` rather
 * than inspect's padded `[ 'a', 'b' ]`). Every list reaching this function is
 * a set of names offered to an operator mid-sentence -- "available: ...",
 * "known: ..." -- where inspect's debugger spacing reads as machine output
 * and costs width that a long list of setting names has no room for.
 */
export function show(value: unknown): string {
  return Array.isArray(value)
    ? `[${value.map((item) => show(item)).join(", ")}]`
    : inspect(value, { depth: null, breakLength: Infinity });
}

/**
 * An untrusted value as the text this tool will carry: a string unchanged,
 * anything else spelled out.
 *
 * Needed wherever a value arrives from outside and is *used* as text rather
 * than reported -- a model's JSON field, a YAML setting, a diff source's
 * record. A string must survive untouched (quoting it would put apostrophes
 * into a finding's body), while a value that is not one still has to become
 * readable: bare `String()` turns an object into `[object Object]`, which
 * loses the very information a reader needs to see what the source sent.
 */
export function asText(value: unknown): string {
  return typeof value === "string" ? value : show(value);
}

/**
 * One line of text: every run of whitespace becomes a single space, and the
 * ends are trimmed.
 *
 * For text that must occupy exactly one line -- a log entry, a finding listed
 * in a collapsed block, a quote echoed back into a prompt. A newline left in
 * any of those does not wrap, it breaks the format around it.
 */
export function collapseWhitespace(text: string): string {
  return text.trim().replaceAll(/\s+/gu, " ");
}

/**
 * A path without leading or trailing separators, so it can be joined onto a
 * root without producing `//` or escaping to the filesystem root.
 */
export function trimSlashes(path: string): string {
  return path.replace(/^\/+/u, "").replace(/\/+$/u, "");
}

/**
 * Whether the text reaches beyond the basic plane, i.e. whether code points
 * and UTF-16 units can disagree about it.
 *
 * Checked first by the two functions below so that the overwhelmingly common
 * case -- text entirely in the basic plane -- costs one scan rather than
 * building an array of every character in a diff.
 *
 * Written as an astral *range*, not as the surrogate range `[\uD800-\uDFFF]`.
 * Under the `u` flag a string is matched as code points, so that range can
 * only ever match a *lone* surrogate -- never a well-formed pair -- and the
 * check it was supposed to make silently answered "no" for every emoji.
 */
const ASTRAL_PATTERN = /[\u{10000}-\u{10FFFF}]/u;

/**
 * How many code points the text is, which is what this tool's character
 * budgets count.
 *
 * Code points, not UTF-16 units: `maxFileChars` and its siblings exist to
 * bound what is sent to a model, and a budget that counted an emoji as two
 * would report a length no reader could verify against the text.
 */
export function countCodePoints(text: string): number {
  // eslint-disable-next-line @typescript-eslint/no-misused-spread -- code-point semantics are the point
  return ASTRAL_PATTERN.test(text) ? [...text].length : text.length;
}

/**
 * The first `maxLength` code points of the text.
 *
 * Cutting by code point is the whole reason this is not `.slice()`: a cap
 * landing between the halves of a surrogate pair would emit a lone surrogate,
 * which is not valid text and which JSON-encodes into a replacement
 * character in whatever reads the report.
 */
export function cutToLength(text: string, maxLength: number): string {
  if (maxLength <= 0) return "";
  if (!ASTRAL_PATTERN.test(text)) return text.slice(0, maxLength);
  // eslint-disable-next-line @typescript-eslint/no-misused-spread -- code-point semantics are the point
  const points = [...text];
  return points.length <= maxLength ? text : points.slice(0, maxLength).join("");
}

/**
 * Every boundary Unicode treats as the end of a line, not merely `\n`.
 *
 * The quote a model returns is matched line by line against the diff, so the
 * two have to agree on what a line is. A model that emitted a vertical tab or
 * a `U+2028` inside its quote would otherwise produce one "line" that matches
 * nothing. `\r\n` leads the alternation so the pair is consumed as one
 * boundary rather than as two empty lines.
 */
// eslint-disable-next-line no-control-regex -- the C0 separators are line boundaries by definition; they are the subject here, not an accident
const LINE_BOUNDARY = /\r\n|[\n\v\f\r\u{1C}\u{1D}\u{1E}\u{85}\u{2028}\u{2029}]/u;

/**
 * The text's lines, without a trailing empty one.
 *
 * Text ending in a newline has as many lines as it has newlines; the empty
 * string after the final boundary is an artefact of splitting, not a line,
 * and counting it would add a phantom line to every quote that ends cleanly.
 */
export function splitLines(text: string): string[] {
  const lines = text.split(LINE_BOUNDARY);
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

/**
 * The text with its first character upper-cased and the rest left alone.
 *
 * Used for one thing: labelling a severity this build does not know, so that
 * a model answering `"blocker"` still reads as `Blocker` in a report. The
 * rest is deliberately untouched -- upper-casing only the front cannot
 * mangle text it does not understand, whereas re-casing the tail turns
 * `İstanbul` into something with a combining dot in it.
 */
export function capitalised(text: string): string {
  const first = text.codePointAt(0);
  if (first === undefined) return text;
  const head = String.fromCodePoint(first);
  return head.toUpperCase() + text.slice(head.length);
}

/**
 * Order two strings by code point: the same answer everywhere, always.
 *
 * Not `localeCompare`, and not the default `.sort()`. A report's ordering is
 * part of what makes two runs comparable -- a reader diffing yesterday's
 * findings against today's must not see reordering that no code caused -- so
 * the comparison cannot depend on the machine's locale. The default sort is
 * locale-independent but orders by UTF-16 unit, which puts an astral
 * character before one in the private-use area; code points are the order a
 * reader would predict.
 */
export function compareCodePoints(a: string, b: string): number {
  if (a === b) return 0;
  const left = Array.from(a, (ch) => ch.codePointAt(0) ?? 0);
  const right = Array.from(b, (ch) => ch.codePointAt(0) ?? 0);
  const shared = Math.min(left.length, right.length);
  for (let index = 0; index < shared; index++) {
    const codeA = left[index] ?? 0;
    const codeB = right[index] ?? 0;
    if (codeA !== codeB) return codeA < codeB ? -1 : 1;
  }
  return left.length < right.length ? -1 : 1;
}

/** The strings in code-point order (see `compareCodePoints`). */
export function sortedByCodePoint(values: Iterable<string>): string[] {
  return [...values].toSorted(compareCodePoints);
}
