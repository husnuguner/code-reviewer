/**
 * How TypeScript and JavaScript declare what a file offers: `export` before a declaration.
 * @packageDocumentation
 */

const EXPORTED_SYMBOL =
  /^\s*export\s+(?:default\s+)?(?:async\s+)?(?:const|let|var|function\*?|class|interface|type|enum|abstract\s+class)\s+([A-Za-z_$][\w$]*)/u;

/** The names the lines declare an `export` of. */
export function exportedNames(lines: readonly string[]): Set<string> {
  const names = new Set<string>();
  for (const line of lines) {
    const match = EXPORTED_SYMBOL.exec(line);
    if (match?.[1] !== undefined) names.add(match[1]);
  }
  return names;
}

/**
 * Export names not worth a repository search. Every route handler of Next.js or Medusa exports `GET` and
 * `POST`, every other module a `default`: the hits are the whole repository rather than this change's
 * users, and the block they fill is the one the cap then spends.
 */
export const UNSEARCHABLE_EXPORTS: ReadonlySet<string> = new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
  "HEAD",
  "default",
  "handler",
  "config",
  "metadata",
  "middlewares",
]);
