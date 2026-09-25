/**
 * The null object for files no language claims -- Markdown, YAML, a language not yet supported. It answers
 * every question of the language port with "nothing": no imports, no exports, no surface. Pre-context then
 * falls back to what needs no syntax, the name and the directory, without the core ever testing for a
 * missing language.
 * @packageDocumentation
 */

import { type LanguageLookup, type LanguageSupport } from "../../ports/language";

import { extensionOf, fileNameOf } from "./paths";

/** The file name before its first dot: `src/a/foo.test.ts` → `foo`. The naming rule most languages share. */
export function defaultStem(path: string): string {
  const name = fileNameOf(path);
  return name.split(".", 1)[0] ?? name;
}

/** Extensions whose mention of a symbol is prose or generated output, not a call a change can break. */
const NON_SOURCE_EXTENSIONS: ReadonlySet<string> = new Set([
  "md",
  "mdx",
  "json",
  "yaml",
  "yml",
  "lock",
  "txt",
  "csv",
  "snap",
  "html",
  "xml",
]);

/**
 * Whether a search hit is a file a signature change could break: not documentation, generated data or a
 * dotfile, which mention every symbol and answer nothing.
 *
 * @remarks A denylist, so a language that does not narrow its usage scope keeps the users other languages
 * would have.
 */
export function isSourceLikePath(path: string): boolean {
  const isDotfile = path.startsWith(".") || path.includes("/.");
  return !isDotfile && !NON_SOURCE_EXTENSIONS.has(extensionOf(path));
}

/** A language that reads nothing: the answer for a file no registered language claims. */
export const PLAIN_TEXT: LanguageSupport = Object.freeze({
  id: "plain-text",
  extensions: [],
  imports: () => [],
  resolve: (_fromPath: string, specifier: string) => ({
    path: specifier,
    candidates: [],
    key: specifier,
  }),
  moduleKey: (path: string) => path,
  exportedNames: () => new Set<string>(),
  unsearchableSymbols: new Set<string>(),
  signatures: () => "",
  stemOf: defaultStem,
  isPossibleUser: isSourceLikePath,
});

/** A lookup that knows no language: every file is plain text. The default for a caller that names none. */
export const NO_LANGUAGES: LanguageLookup = Object.freeze({ forPath: () => PLAIN_TEXT });
