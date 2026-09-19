/**
 * Read-only access to the reviewed repository beyond the diff, bound to one ref.
 * @packageDocumentation
 */

/** One line a search matched. */
export interface CodeSearchHit {
  readonly path: string;
  /** 1-based line number. */
  readonly line: number;
  readonly text: string;
}

/** Reads and searches the repository at the reviewed ref. */
export interface CodeContext {
  /** The whole file at the ref, or `null` when there is no such file. */
  readFile(path: string): Promise<string | null>;
  /**
   * Lines containing a literal needle.
   *
   * @param needle - A literal, not a pattern.
   * @param limit - Maximum hits.
   * @returns `[]` when nothing matches or the adapter cannot search.
   */
  search(needle: string, limit: number): Promise<CodeSearchHit[]>;
}
