/**
 * How TypeScript and JavaScript write a dependency on another file: `import … from`, a dynamic `import()`,
 * and CommonJS `require()`.
 * @packageDocumentation
 */

import { type PatchSides } from "../../../core/ports/language";

/**
 * An import's module specifier: relative (`./x`, `../x`) or repository-root-relative (`src/x`, or whatever
 * prefixes the language was configured with). Built per prefix list.
 *
 * @remarks `\s` spans newlines and the lines are matched as one text, so a specifier on a line of its
 * own -- `await import(\n  "./x"\n)`, how a formatter breaks a long dynamic import -- is found too.
 */
function specifierPattern(rootPrefixes: readonly string[]): RegExp {
  const roots = rootPrefixes.map((prefix) =>
    prefix.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`),
  );
  const local = [String.raw`\.{1,2}\/`, ...roots].join("|");
  return new RegExp(
    String.raw`(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["']((?:${local})[^"']+)["']`,
    "gu",
  );
}

/** Every specifier the lines import, in first-seen order, duplicates included. */
function specifiersIn(lines: readonly string[], pattern: RegExp): string[] {
  const found: string[] = [];
  for (const match of lines.join("\n").matchAll(pattern)) {
    const specifier = match[1];
    if (specifier !== undefined) found.push(specifier);
  }
  return found;
}

/**
 * The local modules the patch shows the file importing, each once: the imports the change wrote first, then
 * the ones only the surrounding context lines show.
 *
 * @remarks Package imports are not local and are skipped. Removed lines are not read: an import the change
 * deleted is not one the file has. Context lines are read because a file's dependency is a dependency
 * whether or not this change happened to touch the import line -- but it ranks second, so a cap still keeps
 * what the change touched.
 */
export function localImports(sides: PatchSides, rootPrefixes: readonly string[]): string[] {
  const pattern = specifierPattern(rootPrefixes);
  return [
    ...new Set([...specifiersIn(sides.added, pattern), ...specifiersIn(sides.kept, pattern)]),
  ];
}
