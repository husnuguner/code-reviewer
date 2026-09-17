/**
 * Path-glob matching with `pathlib.PurePosixPath.full_match` semantics.
 *
 * The rules a skill mapping's globs follow are a behavioural contract
 * (frozen in `tests/fixtures/skills.json`), so they are implemented here rather
 * than delegated to a glob library whose dialect differs in the corners:
 *
 * - `**` alone in a segment matches zero or more segments; joined to other
 *   text (`a/**c.ts`) it is just `*`;
 * - `*` matches within a segment (never `/`); `?` one non-`/` character;
 * - `[...]` is a character class with `!` negation, `]` first as a literal,
 *   and ranges; an unterminated `[` is a literal;
 * - hidden segments (`.git`) are matched by wildcards like any other;
 * - both path and pattern are normalised the way `PurePosixPath` normalises
 *   them: `./a` is `a`, `a//b` is `a/b`, a trailing `/` is dropped;
 * - matching is case-sensitive and covers the whole path.
 */

const NOT_SEP = String.raw`[^/]`;
const ONE_SEGMENT = `${NOT_SEP}+/`;
const ANY_SEGMENTS = `(?:.+/)?`;

/** True if the POSIX `path` matches the glob `pattern` in full. */
export function isGlobMatch(path: string, pattern: string): boolean {
  return compileGlob(pattern).test(normalizePath(path));
}

const cache = new Map<string, RegExp>();

/** The full-match regular expression for a glob, cached per pattern. */
function compileGlob(pattern: string): RegExp {
  const normalized = normalizePath(pattern);
  const cached = cache.get(normalized);
  if (cached !== undefined) return cached;
  const regex = new RegExp(`^(?:${translate(normalized)})$`, "su");
  cache.set(normalized, regex);
  return regex;
}

/**
 * `str(PurePosixPath(text))`: collapse repeated separators, drop `.` segments
 * and a trailing separator. The empty path is `""`, not `"."`, so that empty
 * paths never match wildcards.
 */
function normalizePath(text: string): string {
  const segments = text.split("/").filter((segment) => segment !== "" && segment !== ".");
  const joined = segments.join("/");
  return text.startsWith("/") ? `/${joined}` : joined;
}

/** The regex body for a normalised glob, segment by segment. */
function translate(pattern: string): string {
  const parts = pattern.split("/");
  const lastIndex = parts.length - 1;
  const out: string[] = [];
  for (const [index, part] of parts.entries()) {
    const isLast = index === lastIndex;
    if (part === "*") {
      out.push(isLast ? `${NOT_SEP}+` : ONE_SEGMENT);
    } else if (part === "**") {
      if (isLast) out.push(".*");
      else if (parts[index + 1] !== "**") out.push(ANY_SEGMENTS);
    } else {
      if (part !== "") out.push(translateSegment(part));
      if (!isLast) out.push("/");
    }
  }
  return out.join("");
}

/** One segment's wildcards (`*`, `?`, `[...]`) as regex; everything else escaped. */
function translateSegment(segment: string): string {
  const out: string[] = [];
  let index = 0;
  while (index < segment.length) {
    const [piece, next] = translateAt(segment, index);
    out.push(piece);
    index = next;
  }
  return out.join("");
}

/** The regex for the wildcard or literal starting at `index`, and where the next one starts. */
function translateAt(segment: string, index: number): [piece: string, next: number] {
  const char = segment[index] ?? "";
  switch (char) {
    case "*": {
      let next = index + 1;
      while (segment[next] === "*") next++;
      return [`${NOT_SEP}*`, next];
    }
    case "?": {
      return [NOT_SEP, index + 1];
    }
    case "[": {
      const close = findClassEnd(segment, index + 1);
      return close === -1
        ? [String.raw`\[`, index + 1]
        : [translateClass(segment.slice(index + 1, close)), close + 1];
    }
    default: {
      return [escapeRegex(char), index + 1];
    }
  }
}

/**
 * Index of the `]` closing a class that opened just before `start`, or -1.
 * A leading `!` and a `]` right after it (or after the `[`) are part of the
 * class, not its end.
 */
function findClassEnd(segment: string, start: number): number {
  let index = start;
  if (segment[index] === "!") index++;
  if (segment[index] === "]") index++;
  while (index < segment.length && segment[index] !== "]") index++;
  return index < segment.length ? index : -1;
}

/**
 * A bracket expression's body as a regex class. `!` negates; a leading `^`
 * or `[` is literal; ranges are kept when ordered and dropped when inverted;
 * an empty body never matches and a lone `!` matches anything.
 */
function translateClass(body: string): string {
  const isNegated = body.startsWith("!");
  const inner = isNegated ? body.slice(1) : body;
  if (inner === "") return isNegated ? "." : "(?!)";
  const chunks = splitRanges(inner);
  // A `]` can only be the class's first character (the `]`-first rule); a
  // JavaScript class needs it escaped where Python's `re` reads it literally.
  const escaped = chunks
    .map((chunk) =>
      chunk
        .replaceAll("\\", "\\\\")
        .replaceAll("-", String.raw`\-`)
        .replaceAll("]", String.raw`\]`),
    )
    .join("-");
  const isLeadingMeta = escaped.startsWith("^") || escaped.startsWith("[");
  const prefix = isNegated ? "^" : isLeadingMeta ? "\\" : "";
  return `[${prefix}${escaped}]`;
}

/**
 * Split a class body on the `-` characters that form ranges, dropping any
 * range whose end precedes its start (invalid in a regex). Mirrors the way
 * `fnmatch` normalises `[a-c]`, `[a-]` and `[b-a]`.
 */
function splitRanges(inner: string): string[] {
  if (!inner.includes("-")) return [inner];
  const chunks: string[] = [];
  let start = 0;
  let search = 1;
  for (;;) {
    const dash = inner.indexOf("-", search);
    if (dash === -1) break;
    chunks.push(inner.slice(start, dash));
    start = dash + 1;
    search = dash + 3;
  }
  const tail = inner.slice(start);
  if (tail === "") {
    chunks[chunks.length - 1] = `${chunks.at(-1) ?? ""}-`;
  } else {
    chunks.push(tail);
  }
  for (let index = chunks.length - 1; index > 0; index--) {
    const previous = chunks[index - 1] ?? "";
    const current = chunks[index] ?? "";
    if (!((previous.at(-1) ?? "") > (current[0] ?? ""))) {
      continue;
    }

    chunks[index - 1] = previous.slice(0, -1) + current.slice(1);
    chunks.splice(index, 1);
  }
  return chunks;
}

/**
 * A literal character as regex source. Python's `re.escape` also escapes `-`,
 * which its engine tolerates anywhere; a JavaScript regex with the `u` flag
 * rejects `\-` outside a character class, so `-` stays as it is (it is only
 * special inside `[...]`, which builds its own escaping).
 */
function escapeRegex(char: string): string {
  return /[\\^$.*+?()[\]{}|/]/u.test(char) ? `\\${char}` : char;
}
