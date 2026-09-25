/**
 * The language port: what pre-context needs to know about one programming language to read a patch the way
 * that language writes imports and exports. The core owns the algorithm -- what to gather, in what order,
 * within what budget, through which guard -- and asks a language only the questions its syntax answers.
 *
 * Each question is its own role interface, so a core module depends on the few it asks (interface
 * segregation); {@link LanguageSupport} is all of them, which is what one language implements. A language
 * this port does not know is answered by the plain-text null object, never by a `null` the core must test.
 * @packageDocumentation
 */

/** A patch's lines by side, diff markers stripped. Diff and hunk headers belong to none of them. */
export interface PatchSides {
  /** What the change wrote. */
  readonly added: readonly string[];
  /** What the change removed. */
  readonly removed: readonly string[];
  /** The context git printed around the change. */
  readonly kept: readonly string[];
}

/** Where an import specifier points, as its language resolves it. */
export interface ModuleTarget {
  /** The repository-relative path the specifier names, before any suffix is tried; what a credential check reads. */
  readonly path: string;
  /** Files to try reading, in order; the first that exists is the module. Only files the language can read. */
  readonly candidates: readonly string[];
  /** The module's identity, comparable with {@link ModuleResolution.moduleKey} of another file. */
  readonly key: string;
}

/** How a language writes a dependency on another file of the repository. */
export interface ImportSyntax {
  /**
   * The specifiers of the local modules the patch shows the file importing, each once: the ones the change
   * wrote first, then the ones only the context lines show.
   *
   * @remarks Package imports are not local and are left out. Removed lines are not read: an import the change
   * deleted is not one the file has.
   */
  imports(sides: PatchSides): readonly string[];
}

/** How a language turns a specifier into files. */
export interface ModuleResolution {
  /** Where `specifier`, written in `fromPath`, points. Never above the repository root. */
  resolve(fromPath: string, specifier: string): ModuleTarget;
  /** A file's module identity: two spellings of one module (`x.ts`, `x/index.ts`) compare equal. */
  moduleKey(path: string): string;
}

/** How a language declares what a file offers other files. */
export interface ExportSyntax {
  /**
   * Exported names every file of this language has (`default`, a framework's `GET`): a repository search
   * for them matches everything and answers nothing, so they are not searched for.
   */
  readonly unsearchableSymbols: ReadonlySet<string>;
  /** The names these lines declare as exported. */
  exportedNames(lines: readonly string[]): ReadonlySet<string>;
}

/** How a language's module reads as a surface: what a caller may use, not how it works. */
export interface ModuleSurface {
  /**
   * The module's exported signatures, with their documentation, within `maxChars` code points.
   *
   * @returns Never empty for a non-empty module: a module whose surface cannot be read gives its first lines.
   */
  signatures(text: string, maxChars: number): string;
}

/** How a language names files that belong together. */
export interface FileNaming {
  /** The name two files that belong together share: `foo.test.ts` and `foo.ts` → `foo`. */
  stemOf(path: string): string;
}

/** Which files may use what a language's file exports. */
export interface UsageScope {
  /** Whether a search hit at `path` could be a caller a signature change breaks, rather than prose or data. */
  isPossibleUser(path: string): boolean;
}

/** Everything pre-context asks of one language: what one language implements. */
export interface LanguageSupport
  extends ImportSyntax, ModuleResolution, ExportSyntax, ModuleSurface, FileNaming, UsageScope {
  /** A stable id (`typescript`), for logs and for telling two languages apart. */
  readonly id: string;
  /** The file extensions it reads, lower-case, without the dot. */
  readonly extensions: readonly string[];
}

/** Which language reads a file. */
export interface LanguageLookup {
  /** The language of `path`; the plain-text null object when no language claims it. */
  forPath(path: string): LanguageSupport;
}
