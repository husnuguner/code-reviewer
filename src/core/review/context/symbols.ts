/**
 * Which exported names a change touches, ranked by how likely the change breaks a caller. The ranking is
 * the core's; which lines declare an export is the language's.
 * @packageDocumentation
 */

import { type ExportSyntax, type PatchSides } from "../../ports/language";
import { sortedByCodePoint } from "../../util/text";

/**
 * Names whose export declaration the patch adds, removes or edits, most worth asking about first.
 *
 * @returns Edited signatures (declared on both sides) first, then new or deleted exports; alphabetical within
 * a rank.
 */
export function changedSymbols(sides: PatchSides, syntax: ExportSyntax): string[] {
  const inAdded = syntax.exportedNames(sides.added);
  const inRemoved = syntax.exportedNames(sides.removed);
  const edited = (name: string): number => (inAdded.has(name) && inRemoved.has(name) ? 0 : 1);
  const touched = new Set(inAdded);
  for (const name of inRemoved) touched.add(name);
  return sortedByCodePoint(touched).toSorted((a, b) => edited(a) - edited(b));
}
