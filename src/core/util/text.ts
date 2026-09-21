/**
 * Text primitives the platform lacks: code-point budgets, Unicode line splitting, locale-free ordering.
 * @packageDocumentation
 */

import { inspect } from "node:util";

/**
 * Spells a value as a message shows it: strings quoted, lists compact, the rest as Node inspects it.
 *
 * @param value - Any value a message names.
 * @returns e.g. `'a'`, `['a', 'b']`, `0`, `null`.
 * @remarks Fixed `breakLength` keeps every message on one line.
 */
export function show(value: unknown): string {
  return Array.isArray(value)
    ? `[${value.map((item) => show(item)).join(", ")}]`
    : inspect(value, { depth: null, breakLength: Infinity });
}

/**
 * Carries an untrusted value as text: a string unchanged, anything else spelled out.
 *
 * @param value - A field from a model reply, a setting, or a diff record.
 * @returns The string itself, or `show(value)`.
 */
export function asText(value: unknown): string {
  return typeof value === "string" ? value : show(value);
}

/** Collapses every whitespace run to one space and trims the ends. */
export function collapseWhitespace(text: string): string {
  return text.trim().replaceAll(/\s+/gu, " ");
}

/** Strips leading and trailing `/` so a path can be joined onto a root. */
export function trimSlashes(path: string): string {
  return path.replace(/^\/+/u, "").replace(/\/+$/u, "");
}

/**
 * Whether the text contains a code point beyond the basic plane.
 *
 * @remarks An astral range, not `[\uD800-\uDFFF]`: under `u` the surrogate range only matches lone surrogates.
 */
const ASTRAL_PATTERN = /[\u{10000}-\u{10FFFF}]/u;

/**
 * Counts code points, which is what the character budgets count.
 *
 * @param text - The text to measure.
 * @returns The code-point length.
 */
export function countCodePoints(text: string): number {
  // eslint-disable-next-line @typescript-eslint/no-misused-spread -- code-point semantics are the point
  return ASTRAL_PATTERN.test(text) ? [...text].length : text.length;
}

/** Formats a count with thousands separators: `7036` → `7,036`. */
export function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}

/**
 * Takes the first `maxLength` code points, never splitting a surrogate pair.
 *
 * @param text - The text to cut.
 * @param maxLength - The budget; `<= 0` yields `""`.
 * @returns The cut text.
 */
export function cutToLength(text: string, maxLength: number): string {
  if (maxLength <= 0) return "";
  if (!ASTRAL_PATTERN.test(text)) return text.slice(0, maxLength);
  // eslint-disable-next-line @typescript-eslint/no-misused-spread -- code-point semantics are the point
  const points = [...text];
  return points.length <= maxLength ? text : points.slice(0, maxLength).join("");
}

/** Every line boundary Unicode defines; `\r\n` first so the pair is one boundary. */
// eslint-disable-next-line no-control-regex -- the C0 separators are line boundaries by definition
const LINE_BOUNDARY = /\r\n|[\n\v\f\r\u{1C}\u{1D}\u{1E}\u{85}\u{2028}\u{2029}]/u;

/**
 * Splits text into lines on every Unicode line boundary.
 *
 * @param text - The text to split.
 * @returns The lines, without the empty one a trailing newline would produce.
 */
export function splitLines(text: string): string[] {
  const lines = text.split(LINE_BOUNDARY);
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

/**
 * Upper-cases the first code point only.
 *
 * @remarks The tail is left alone so text in an unknown language is not mangled.
 */
export function capitalised(text: string): string {
  const first = text.codePointAt(0);
  if (first === undefined) return text;
  const head = String.fromCodePoint(first);
  return head.toUpperCase() + text.slice(head.length);
}

/**
 * Orders two strings by code point, independent of locale.
 *
 * @returns `-1`, `0` or `1`, as a sort comparator expects.
 * @remarks Not `localeCompare` (varies by machine) and not the default sort (orders by UTF-16 unit).
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

/** Sorts strings by code point (see {@link compareCodePoints}). */
export function sortedByCodePoint(values: Iterable<string>): string[] {
  return [...values].toSorted(compareCodePoints);
}
