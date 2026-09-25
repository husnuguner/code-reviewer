/**
 * A changed file's imports, read once per language. `imports` is asked once per ordered pair of a change
 * set when related files are ranked; the answer depends only on the patch, which a changed file never
 * changes, and on the language reading it.
 * @packageDocumentation
 */

import { type ChangedFile } from "../../domain/changed-file";
import { type ImportSyntax } from "../../ports/language";

import { patchSides } from "./patch-sides";

const BY_LANGUAGE = new WeakMap<ImportSyntax, WeakMap<ChangedFile, readonly string[]>>();

/** The local modules `file`'s patch shows it importing, as `language` reads them; memoised. */
export function importsOf(language: ImportSyntax, file: ChangedFile): readonly string[] {
  let byFile = BY_LANGUAGE.get(language);
  if (byFile === undefined) {
    byFile = new WeakMap();
    BY_LANGUAGE.set(language, byFile);
  }
  const memoised = byFile.get(file);
  if (memoised !== undefined) return memoised;
  const imports = language.imports(patchSides(file.patch));
  byFile.set(file, imports);
  return imports;
}
