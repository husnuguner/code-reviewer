/**
 * The built-in languages. To add one: extend `Language` and list an instance here -- pre-context reads its
 * files from the next run on. A file no listed language claims is read as plain text.
 * @packageDocumentation
 */

import { type Language } from "./language";
import { LanguageRegistry } from "./registry";
import { TypeScriptLanguage } from "./typescript/language";

/** Every language pre-context reads beyond plain text. */
export const BUILTIN_LANGUAGES: readonly Language[] = [new TypeScriptLanguage()];

/** A registry of the built-in languages. */
export function builtinLanguages(): LanguageRegistry {
  return new LanguageRegistry(BUILTIN_LANGUAGES);
}
