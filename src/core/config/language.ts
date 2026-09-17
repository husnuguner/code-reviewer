/**
 * The human language findings are written in, normalised once.
 *
 * A configuration concern, not a review one: `--lang tr`, `REVIEW_LANG=tur`
 * and a project's `"lang": "turkish"` must all mean the same thing before the
 * review layer ever sees them. It lives beside the settings schema so that the
 * schema never has to import the review package to normalise a value.
 */

import { pyStrip } from "../util/py";

/** Accepted `--lang` / `REVIEW_LANG` values -> language name used in the prompt. */
const LANGUAGES: Readonly<Record<string, string>> = {
  tr: "Turkish",
  tur: "Turkish",
  turkish: "Turkish",
  turkce: "Turkish",
  türkçe: "Turkish",
  en: "English",
  eng: "English",
  english: "English",
};

export const DEFAULT_LANGUAGE = "English";

/** Normalise a language code/name to the prompt language (default English). */
export function languageName(value: string | null | undefined): string {
  return value ? (LANGUAGES[pyStrip(value).toLowerCase()] ?? DEFAULT_LANGUAGE) : DEFAULT_LANGUAGE;
}
