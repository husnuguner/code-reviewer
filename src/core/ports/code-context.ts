/**
 * Read-only access to the reviewed repository *beyond the diff*, at one ref.
 *
 * The per-file review sees only a patch (and, for a small change, the file).
 * Some findings cannot be judged from that alone: what a called function does,
 * who else uses a symbol whose signature changed, whether an imported module
 * exists. This port is how the review reaches that context. It is bound to a
 * ref by construction -- the head of the change under review -- so nothing it
 * returns can be newer than the code being judged.
 *
 * Two adapters: local git (full: `git show`, `git grep`), and the repo provider
 * (reads any file at the ref; search is limited to what is already in hand,
 * because a hosting API's code search indexes the default branch, not a head).
 */

export interface CodeSearchHit {
  readonly path: string;
  /** 1-based line number. */
  readonly line: number;
  readonly text: string;
}

export interface CodeContext {
  /** The whole file at the ref, or `null` when there is no such file. */
  readFile(path: string): Promise<string | null>;
  /**
   * Lines containing `needle` (a literal, not a pattern), at most `limit`.
   * `[]` when nothing matches -- or when this adapter cannot search.
   */
  search(needle: string, limit: number): Promise<CodeSearchHit[]>;
}
