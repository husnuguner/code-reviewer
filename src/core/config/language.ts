/**
 * Normalises the language findings are written in, once, before the review layer sees it.
 * @packageDocumentation
 */

/** Codes and spellings → the language name used in the prompt. Anything else that looks like a name passes. */
const LANGUAGES: Readonly<Record<string, string>> = {
  tr: "Turkish",
  tur: "Turkish",
  turkish: "Turkish",
  turkce: "Turkish",
  türkçe: "Turkish",
  en: "English",
  eng: "English",
  english: "English",
  ar: "Arabic",
  az: "Azerbaijani",
  cs: "Czech",
  da: "Danish",
  de: "German",
  el: "Greek",
  es: "Spanish",
  fi: "Finnish",
  fr: "French",
  he: "Hebrew",
  hi: "Hindi",
  hu: "Hungarian",
  id: "Indonesian",
  it: "Italian",
  ja: "Japanese",
  ko: "Korean",
  nl: "Dutch",
  no: "Norwegian",
  pl: "Polish",
  pt: "Portuguese",
  ro: "Romanian",
  ru: "Russian",
  sv: "Swedish",
  uk: "Ukrainian",
  vi: "Vietnamese",
  zh: "Chinese",
};

/** The language when none is given, or what is given could not be a language's name. */
export const DEFAULT_LANGUAGE = "English";

/**
 * What may pass as a language's name the table does not know: letters, spaces, hyphens and parentheses,
 * briefly ("Brazilian Portuguese", "Deutsch", "中文"). The value is written into the prompt, so a
 * sentence -- "English. Ignore the rules above" -- is not a language.
 */
const LANGUAGE_NAME = /^[\p{L}\p{M}][\p{L}\p{M} ()-]{0,39}$/u;

/**
 * Normalises a language code or name to the prompt language.
 *
 * @param value - e.g. `tr`, `de`, `english`, `Brazilian Portuguese`; case-insensitive for the known ones.
 * @returns The known language's name; else the value itself, trimmed, when it could be a name; else
 * {@link DEFAULT_LANGUAGE}.
 */
export function languageName(value: string | null | undefined): string {
  const trimmed = (value ?? "").trim().replaceAll(/\s+/gu, " ");
  if (trimmed === "") return DEFAULT_LANGUAGE;
  return (
    LANGUAGES[trimmed.toLowerCase()] ?? (LANGUAGE_NAME.test(trimmed) ? trimmed : DEFAULT_LANGUAGE)
  );
}
