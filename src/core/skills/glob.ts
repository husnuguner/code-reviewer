/**
 * Path-glob matching with `Bun.Glob` semantics: `**` spans segments, `*` and `?` stay within one,
 * `[...]` classes with `!` or `^` negation, `{a,b}` alternatives, `\` escapes the next character;
 * case-sensitive, whole path.
 * @packageDocumentation
 */

/**
 * Whether a POSIX path matches a glob in full.
 *
 * @param path - The repository-relative path.
 * @param pattern - The glob.
 */
export function isGlobMatch(path: string, pattern: string): boolean {
  return compileGlob(pattern).match(normalizePath(path));
}

const cache = new Map<string, Bun.Glob>();

/** The compiled glob for a pattern, cached per normalised pattern. */
function compileGlob(pattern: string): Bun.Glob {
  const normalized = normalizePath(pattern);
  const cached = cache.get(normalized);
  if (cached !== undefined) return cached;
  const glob = new Bun.Glob(normalized);
  cache.set(normalized, glob);
  return glob;
}

/** Collapses repeated `/`, drops `.` segments and a trailing `/`; the empty path stays `""`. */
function normalizePath(text: string): string {
  const segments = text.split("/").filter((segment) => segment !== "" && segment !== ".");
  const joined = segments.join("/");
  return text.startsWith("/") ? `/${joined}` : joined;
}
