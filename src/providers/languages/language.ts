/**
 * The language kind: the base every supported language extends. It fixes what a language is (an id, its
 * extensions, the answers `LanguageSupport` asks for) and supplies the answers most languages share, so a
 * new language writes only what its syntax makes different.
 *
 * Adding a language is one class of this kind and one line in `builtin.ts`: the core's pre-context, the
 * registry and the composition root learn it from there.
 * @packageDocumentation
 */

import {
  type LanguageSupport,
  type ModuleTarget,
  type PatchSides,
} from "../../core/ports/language";
import { defaultStem, isSourceLikePath } from "../../core/review/context/plain-text";

/** One programming language, as pre-context reads it. */
export abstract class Language implements LanguageSupport {
  /** Exported names every file has; none by default. */
  readonly unsearchableSymbols: ReadonlySet<string> = new Set();
  /** A stable id (`typescript`), for logs and for telling two languages apart. */
  abstract readonly id: string;
  /** The extensions this language reads, lower-case, without the dot. */
  abstract readonly extensions: readonly string[];

  /** A file's module identity; by default the path without its extension. */
  moduleKey(path: string): string {
    return path.replace(/\.[^./]+$/u, "");
  }

  /** The name before the first dot (`foo.test.ts` → `foo`); override where a language names otherwise. */
  stemOf(path: string): string {
    return defaultStem(path);
  }

  /** Any file that is not documentation, data or a dotfile; override to narrow. */
  isPossibleUser(path: string): boolean {
    return isSourceLikePath(path);
  }

  /** The local imports the patch shows, the change's first; see `ImportSyntax`. */
  abstract imports(sides: PatchSides): readonly string[];

  /** Where a specifier points; see `ModuleResolution`. */
  abstract resolve(fromPath: string, specifier: string): ModuleTarget;

  /** The names these lines export; see `ExportSyntax`. */
  abstract exportedNames(lines: readonly string[]): ReadonlySet<string>;

  /** A module's surface; see `ModuleSurface`. */
  abstract signatures(text: string, maxChars: number): string;
}
