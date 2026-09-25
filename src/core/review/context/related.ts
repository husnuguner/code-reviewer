/**
 * Which other changed files belong with the one under review, and why. Language-agnostic: an import edge is
 * drawn by the files' language, the name heuristics by its naming rule; a file of another language is never
 * bound by either, because two languages' specifiers and stems do not compare.
 * @packageDocumentation
 */

import { type ChangedFile } from "../../domain/changed-file";
import { type LanguageLookup, type LanguageSupport } from "../../ports/language";
import { compareCodePoints } from "../../util/text";

import { importsOf } from "./imports";
import { directoryOf } from "./paths";
import { NO_LANGUAGES, PLAIN_TEXT } from "./plain-text";
import { type RelatedRelation } from "./types";

/** Whether `from`'s patch shows it importing `to`: both read by one real language, and a specifier resolving there. */
function hasImportOf(
  from: ChangedFile,
  to: ChangedFile,
  language: LanguageSupport,
  other: LanguageSupport,
): boolean {
  if (language === PLAIN_TEXT || language !== other) return false;
  const target = language.moduleKey(to.path);
  return importsOf(language, from).some(
    (specifier) => language.resolve(from.path, specifier).key === target,
  );
}

/**
 * How `other` relates to the file under review.
 *
 * @returns `imports` when the file under review imports it, `imported-by` for the other direction,
 * `sibling` when only the name or the directory connects them.
 */
export function relationTo(
  file: ChangedFile,
  other: ChangedFile,
  languages: LanguageLookup = NO_LANGUAGES,
): RelatedRelation {
  const mine = languages.forPath(file.path);
  const theirs = languages.forPath(other.path);
  if (hasImportOf(file, other, mine, theirs)) return "imports";
  return hasImportOf(other, file, theirs, mine) ? "imported-by" : "sibling";
}

/** Rank of a related file: `0` an import edge, `1` the same stem in the same language, `2` anything else. */
const IMPORT_BOUND = 0;
const SAME_STEM = 1;
const OTHER = 2;

/**
 * The other changed files that belong with this one: bound by an import, or sharing the stem or the
 * directory.
 *
 * @remarks The import edge outranks both name heuristics because it is the relation a change actually
 * breaks -- `api/handler.ts` and the `services/users.ts` it imports share neither stem nor directory,
 * and with a cap of three the siblings of a crowded directory would otherwise crowd the dependency out.
 * A stem is compared only within one language: `service.py` is not `service.ts`'s counterpart.
 * @returns Import-bound files first, then the same stem, then the same directory; by path within a rank.
 */
export function relatedChanges(
  file: ChangedFile,
  all: readonly ChangedFile[],
  languages: LanguageLookup = NO_LANGUAGES,
): ChangedFile[] {
  const language = languages.forPath(file.path);
  const stem = language.stemOf(file.path);
  const directory = directoryOf(file.path);
  const rank = (other: ChangedFile): number => {
    if (relationTo(file, other, languages) !== "sibling") return IMPORT_BOUND;
    const theirs = languages.forPath(other.path);
    return theirs === language && theirs.stemOf(other.path) === stem ? SAME_STEM : OTHER;
  };
  const candidates = all.filter(
    (other) =>
      other.path !== file.path &&
      other.patch !== "" &&
      (rank(other) < OTHER || directoryOf(other.path) === directory),
  );
  return candidates.toSorted((a, b) => rank(a) - rank(b) || compareCodePoints(a.path, b.path));
}
