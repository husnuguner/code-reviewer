/**
 * Text and value primitives with Python's semantics.
 *
 * The review pipeline's behavioural contract (frozen in `tests/fixtures/`) is
 * defined in terms of Python's string rules, which differ from JavaScript's in
 * ways that would otherwise change results silently: whitespace splitting
 * swallows leading/trailing runs, line splitting knows more boundaries than
 * `\n`, lengths count code points, and empty containers are falsy. Every place
 * that depends on one of those rules goes through a helper here rather than
 * restating the rule locally, so a correction lands once.
 *
 * `tests/contracts/pystr.contract.test.ts` pins each helper to the fixtures.
 */

/**
 * Characters `str.isspace()` accepts: Unicode categories Zs plus the
 * bidirectional classes WS, B and S. Notably wider than JavaScript's `\s` at
 * the control-character end (`\x1c`–`\x1f`, `\x85`) and narrower at the top
 * (`\ufeff` is *not* whitespace in Python).
 */
export const PY_WHITESPACE_CLASS = String.raw`[\t\n\x0b\x0c\r\x1c-\x1f \x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]`;

const WS_RUN = new RegExp(`${PY_WHITESPACE_CLASS}+`, "gu");
const WS_LEADING = new RegExp(`^${PY_WHITESPACE_CLASS}+`, "u");
const WS_TRAILING = new RegExp(`${PY_WHITESPACE_CLASS}+$`, "u");

/** `str.split()` with no separator: runs of whitespace, no empty fields. */
export function pySplit(s: string): string[] {
  const stripped = pyStrip(s);
  return stripped === "" ? [] : stripped.split(WS_RUN);
}

/** `str.strip()` with no argument. */
export function pyStrip(s: string): string {
  return s.replace(WS_LEADING, "").replace(WS_TRAILING, "");
}

/** `str.rstrip()` with no argument. */
export function pyRstrip(s: string): string {
  return s.replace(WS_TRAILING, "");
}

/** `str.strip(chars)`: strip any of the given characters from both ends. */
export function pyStripChars(s: string, chars: string): string {
  const set = new Set(codePoints(chars));
  const cps = codePoints(s);
  let start = 0;
  let end = cps.length;
  while (start < end && set.has(cps[start] ?? "")) start++;
  while (end > start && set.has(cps[end - 1] ?? "")) end--;
  return cps.slice(start, end).join("");
}

/**
 * Code points `str.splitlines()` treats as a line boundary, besides the
 * `\r\n` pair: `\n`, `\v`, `\f`, `\r`, `\x1c`, `\x1d`, `\x1e`, `\x85`,
 * `\u2028`, `\u2029`.
 */
const LINE_BOUNDARIES: ReadonlySet<number> = new Set([
  0x0a, 0x0b, 0x0c, 0x0d, 0x1c, 0x1d, 0x1e, 0x85, 0x20_28, 0x20_29,
]);

/**
 * `str.splitlines()`: splits on every boundary Python recognises and drops the
 * trailing empty element a terminating newline would otherwise produce.
 */
export function pySplitlines(s: string): string[] {
  const out: string[] = [];
  let start = 0;
  let index = 0;
  const n = s.length;
  while (index < n) {
    const cp = s.codePointAt(index) ?? 0;
    if (!LINE_BOUNDARIES.has(cp)) {
      index += 1;
      continue;
    }
    out.push(s.slice(start, index));
    const isCrLf = cp === 0x0d && s.codePointAt(index + 1) === 0x0a;
    index += isCrLf ? 2 : 1;
    start = index;
  }
  if (start < n) out.push(s.slice(start));
  return out;
}

const CASED = /\p{Cased}/u;

/**
 * `str.title()`: the first cased character of every run of cased characters is
 * upper-cased and the rest lower-cased. Anything uncased (digits, apostrophes,
 * punctuation) ends the run, which is why `"they're"` becomes `"They'Re"`.
 */
export function pyTitle(s: string): string {
  let out = "";
  let isPreviousCased = false;
  for (const ch of codePoints(s)) {
    if (CASED.test(ch)) {
      out += isPreviousCased ? ch.toLowerCase() : ch.toUpperCase();
      isPreviousCased = true;
    } else {
      out += ch;
      isPreviousCased = false;
    }
  }
  return out;
}

const SURROGATE_PATTERN = /[\uD800-\uDFFF]/;

/**
 * The string as an array of code points (never splits a surrogate pair).
 *
 * Code points -- not grapheme clusters -- are the intended unit: Python's
 * `len()`, slicing and iteration all work on code points, and this module
 * exists to reproduce them.
 */
function codePoints(s: string): string[] {
  // eslint-disable-next-line @typescript-eslint/no-misused-spread -- code-point semantics are the point
  return [...s];
}

/** `len(s)`: code points, not UTF-16 units. */
export function pyLength(s: string): number {
  return SURROGATE_PATTERN.test(s) ? codePoints(s).length : s.length;
}

/**
 * `s[start:end]` over code points with non-negative bounds. Slicing by UTF-16
 * unit could split a surrogate pair, which Python never does.
 */
export function pySlice(s: string, start: number, end?: number): string {
  return SURROGATE_PATTERN.test(s) ? codePoints(s).slice(start, end).join("") : s.slice(start, end);
}

/**
 * `str(value)` for JSON-shaped values. `null` and the booleans spell
 * themselves the Python way (`None`, `True`, `False`); the contract fixtures
 * depend on that for model output such as `"body": null`.
 */
export function pyString(value: unknown): string {
  switch (typeof value) {
    case "string": {
      return value;
    }
    case "number": {
      return pyNumberString(value);
    }
    case "boolean": {
      return value ? "True" : "False";
    }
    case "undefined": {
      return "None";
    }
    case "bigint": {
      return value.toString();
    }
    case "object": {
      return value === null ? "None" : pyRepr(value);
    }
    case "symbol":
    case "function": {
      return `<${typeof value}>`;
    }
  }
}

function pyNumberString(n: number): string {
  if (Number.isNaN(n)) return "nan";
  if (n === Infinity) return "inf";
  return n === -Infinity ? "-inf" : String(n);
}

/**
 * `repr(value)` for JSON-shaped values: single-quoted strings (double-quoted
 * when the text contains a single quote and no double quote), `None`/`True`/
 * `False`, and Python's list/dict spelling with `, ` and `: ` separators.
 */
export function pyRepr(value: unknown): string {
  if (typeof value === "string") return pyReprString(value);
  if (Array.isArray(value)) return `[${value.map(pyRepr).join(", ")}]`;
  if (isDict(value)) {
    const parts = Object.entries(value).map(([k, v]) => `${pyReprString(k)}: ${pyRepr(v)}`);
    return `{${parts.join(", ")}}`;
  }
  return pyString(value);
}

function pyReprString(s: string): string {
  const quote = s.includes("'") && !s.includes('"') ? '"' : "'";
  let out = quote;
  for (const ch of codePoints(s)) {
    out += pyReprChar(ch, quote);
  }
  return out + quote;
}

function pyReprChar(ch: string, quote: string): string {
  const cp = ch.codePointAt(0) ?? 0;
  if (ch === quote || ch === "\\") return `\\${ch}`;
  if (ch === "\n") return String.raw`\n`;
  if (ch === "\r") return String.raw`\r`;
  if (ch === "\t") return String.raw`\t`;
  const isControl = cp < 0x20 || cp === 0x7f;
  return isControl ? `\\x${cp.toString(16).padStart(2, "0")}` : ch;
}

/**
 * Python truthiness for JSON-shaped values: empty strings, arrays and objects
 * are falsy, as are `0`, `NaN`, `null` and `undefined`.
 */
export function isPyTruthy(value: unknown): boolean {
  switch (typeof value) {
    case "string": {
      return value.length > 0;
    }
    case "number": {
      return value !== 0 && !Number.isNaN(value);
    }
    case "boolean": {
      return value;
    }
    case "undefined": {
      return false;
    }
    case "bigint": {
      return value !== 0n;
    }
    case "object": {
      if (value === null) return false;
      const size = Array.isArray(value) ? value.length : Object.keys(value).length;
      return size > 0;
    }
    case "symbol":
    case "function": {
      return true;
    }
  }
}

/** `type(value).__name__` for JSON-shaped values. */
export function pyTypeName(value: unknown): string {
  if (Array.isArray(value)) return "list";
  switch (typeof value) {
    case "boolean": {
      return "bool";
    }
    case "number": {
      return Number.isSafeInteger(value) ? "int" : "float";
    }
    case "string": {
      return "str";
    }
    case "object": {
      return value === null ? "NoneType" : "dict";
    }
    case "undefined": {
      return "NoneType";
    }
    case "bigint": {
      return "int";
    }
    case "symbol":
    case "function": {
      return typeof value;
    }
  }
}

/** `isinstance(value, dict)` for decoded JSON: a plain object, not an array. */
export function isDict(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * `isinstance(value, int)` for decoded JSON. Python's `bool` is an `int`
 * subclass; this deliberately does not honour that, since a model answering
 * `"line": true` was never meant to name line 1.
 */
export function isInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

/**
 * Python `==` on JSON-shaped values: structural equality, order-sensitive for
 * lists and order-insensitive for dicts.
 */
export function isPyEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => isPyEqual(item, b[index]));
  }
  if (isDict(a) && isDict(b)) {
    const keys = Object.keys(a);
    const isSameSize = keys.length === Object.keys(b).length;
    return isSameSize && keys.every((k) => Object.hasOwn(b, k) && isPyEqual(a[k], b[k]));
  }
  return false;
}

/** `sorted(strings)`: code-point order, never locale-aware. */
export function pySorted(values: Iterable<string>): string[] {
  return [...values].toSorted(compareCodePoints);
}

/** Python's default string ordering (by code point). */
export function compareCodePoints(a: string, b: string): number {
  if (a === b) return 0;
  const left = codePoints(a);
  const right = codePoints(b);
  const shared = Math.min(left.length, right.length);
  for (let index = 0; index < shared; index++) {
    const codeA = left[index]?.codePointAt(0) ?? 0;
    const codeB = right[index]?.codePointAt(0) ?? 0;
    if (codeA !== codeB) return codeA < codeB ? -1 : 1;
  }
  return left.length < right.length ? -1 : 1;
}
