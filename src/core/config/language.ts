/**
 * Normalises the language findings are written in, once, before the review layer sees it.
 * @packageDocumentation
 */

/** Accepted `--lang` / `REVIEW_LANG` values → the language name used in the prompt. */
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

/** The language when none, or an unknown one, is given. */
export const DEFAULT_LANGUAGE = "English";

/**
 * Normalises a language code or name to the prompt language.
 *
 * @param value - e.g. `tr`, `en`, `english`; case-insensitive.
 * @returns The language name, or {@link DEFAULT_LANGUAGE} when unknown or empty.
 */
export function languageName(value: string | null | undefined): string {
  return value ? (LANGUAGES[value.trim().toLowerCase()] ?? DEFAULT_LANGUAGE) : DEFAULT_LANGUAGE;
}
