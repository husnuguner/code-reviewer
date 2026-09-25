/**
 * `typescript`: TypeScript and JavaScript, ES modules and CommonJS alike. Composes the four syntax readers
 * of this folder into the `Language` kind.
 * @packageDocumentation
 */

import { type ModuleTarget, type PatchSides } from "../../../core/ports/language";
import { Language } from "../language";

import { UNSEARCHABLE_EXPORTS, exportedNames } from "./exports";
import { localImports } from "./imports";
import { CODE_EXTENSIONS, moduleKey, moduleTarget } from "./modules";
import { exportSignatures } from "./signatures";

/** Options for {@link TypeScriptLanguage}. */
export interface TypeScriptLanguageOptions {
  /**
   * Specifier prefixes taken as repository-root-relative instead of relative to the importing file: the
   * `baseUrl: "."` spelling (`src/workflows/x`) that Medusa and many TypeScript projects use. Default
   * `["src/"]`.
   */
  readonly rootRelativePrefixes?: readonly string[];
}

/** TypeScript and JavaScript. */
export class TypeScriptLanguage extends Language {
  readonly id = "typescript";
  readonly extensions = CODE_EXTENSIONS;
  override readonly unsearchableSymbols = UNSEARCHABLE_EXPORTS;
  private readonly rootPrefixes: readonly string[];

  constructor(options: TypeScriptLanguageOptions = {}) {
    super();
    this.rootPrefixes = options.rootRelativePrefixes ?? ["src/"];
  }

  imports(sides: PatchSides): readonly string[] {
    return localImports(sides, this.rootPrefixes);
  }

  resolve(fromPath: string, specifier: string): ModuleTarget {
    return moduleTarget(fromPath, specifier, this.rootPrefixes);
  }

  override moduleKey(path: string): string {
    return moduleKey(path);
  }

  exportedNames(lines: readonly string[]): ReadonlySet<string> {
    return exportedNames(lines);
  }

  signatures(text: string, maxChars: number): string {
    return exportSignatures(text, maxChars);
  }
}
