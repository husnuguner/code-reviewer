/**
 * Path-glob matching with `PurePosixPath.full_match` semantics: `**` spans segments, `*` and `?` stay
 * within one, `[...]` classes with `!` negation, case-sensitive, whole path.
 * @packageDocumentation
 */

const NOT_SEP = String.raw`[^/]`;
const ONE_SEGMENT = `${NOT_SEP}+/`;
const ANY_SEGMENTS = `(?:.+/)?`;

/**
 * Whether a POSIX path matches a glob in full.
 *
 * @param path - The repository-relative path.
 * @param pattern - The glob.
 */
export function isGlobMatch(path: string, pattern: string): boolean {
  return compileGlob(pattern).test(normalizePath(path));
}

const cache = new Map<string, RegExp>();

/** The full-match regex for a glob, cached per pattern. */
function compileGlob(pattern: string): RegExp {
  const normalized = normalizePath(pattern);
  const cached = cache.get(normalized);
  if (cached !== undefined) return cached;
  const regex = new RegExp(`^(?:${translate(normalized)})$`, "su");
  cache.set(normalized, regex);
  return regex;
}

/** Collapses repeated `/`, drops `.` segments and a trailing `/`; the empty path stays `""`. */
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

/** One segment's wildcards as regex; everything else escaped. */
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

/** The regex for the wildcard or literal at `index`, and where the next one starts. */
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

/** Index of the `]` closing a class opened before `start`, or `-1`; a leading `!` or `]` is part of the class. */
function findClassEnd(segment: string, start: number): number {
  let index = start;
  if (segment[index] === "!") index++;
  if (segment[index] === "]") index++;
  while (index < segment.length && segment[index] !== "]") index++;
  return index < segment.length ? index : -1;
}

/** A bracket body as a regex class: `!` negates, an empty body never matches, inverted ranges are dropped. */
function translateClass(body: string): string {
  const isNegated = body.startsWith("!");
  const inner = isNegated ? body.slice(1) : body;
  if (inner === "") return isNegated ? "." : "(?!)";
  const chunks = splitRanges(inner);
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

/** Splits a class body on range dashes, dropping ranges whose end precedes their start. */
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

/** A literal character as regex source. `-` is not escaped: with `u`, `\-` is invalid outside a class. */
function escapeRegex(char: string): string {
  return /[\\^$.*+?()[\]{}|/]/u.test(char) ? `\\${char}` : char;
}
