/**
 * The languages a run knows, selected by a file's extension. The `LanguageLookup` port's implementation:
 * the core asks for a path's language and always gets one -- the plain-text null object when no language
 * claims the extension.
 * @packageDocumentation
 */

import { type LanguageLookup, type LanguageSupport } from "../../core/ports/language";
import { extensionOf } from "../../core/review/context/paths";
import { PLAIN_TEXT } from "../../core/review/context/plain-text";
import { ValueError } from "../../core/util/errors";

/** Languages by extension. */
export class LanguageRegistry implements LanguageLookup {
  private readonly byId = new Map<string, LanguageSupport>();
  private readonly byExtension = new Map<string, LanguageSupport>();

  /**
   * @param languages - Initial registrations, in order.
   * @param fallback - The language of a file no registered language claims.
   */
  constructor(
    languages: readonly LanguageSupport[] = [],
    private readonly fallback: LanguageSupport = PLAIN_TEXT,
  ) {
    for (const language of languages) this.register(language);
  }

  /**
   * Registers a language; one with an id already registered replaces it, extensions and all.
   *
   * @throws {@link ValueError} when an extension already belongs to a language with another id: which of
   * the two reads the file would be an accident of order.
   */
  register(language: LanguageSupport): void {
    const replaced = this.byId.get(language.id);
    for (const extension of language.extensions) {
      const owner = this.byExtension.get(extension.toLowerCase());
      if (owner !== undefined && owner.id !== language.id) {
        throw new ValueError(
          `The extension '.${extension}' is claimed by both '${owner.id}' and '${language.id}'.`,
        );
      }
    }
    if (replaced !== undefined) {
      for (const extension of replaced.extensions) this.byExtension.delete(extension.toLowerCase());
    }
    this.byId.set(language.id, language);
    for (const extension of language.extensions) {
      this.byExtension.set(extension.toLowerCase(), language);
    }
  }

  forPath(path: string): LanguageSupport {
    return this.byExtension.get(extensionOf(path)) ?? this.fallback;
  }

  /** The registered ids, in registration order. */
  ids(): string[] {
    return this.byId.keys().toArray();
  }
}
