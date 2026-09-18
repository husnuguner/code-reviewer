/**
 * The local-git port: branch review's diff source.
 *
 * Branch review compares a branch against a base from a working tree, so it
 * needs no repo provider and no credentials -- which is why it works against a
 * repository whose hosting system nobody has implemented, and against work
 * that has not been pushed or even committed. Reading git is an
 * infrastructure concern; the flow only needs these four operations.
 */

import { type ChangedFileEntry } from "../domain/changed-file";

export interface GitReader {
  /** The working tree's root directory. */
  readonly root: string;

  /**
   * Where `branch` forked from `base`, or `null` when unrelated.
   *
   * `null` is not fatal: the caller falls back to comparing against `base`
   * directly, which is the two-dot diff and still says something useful.
   */
  mergeBase(base: string, branch: string): Promise<string | null>;

  /**
   * The three-dot diff (`base...branch`), one provider-shaped entry per file.
   * Removed files and files with no textual hunks are not reported.
   */
  changedFiles(base: string, branch: string): Promise<ChangedFileEntry[]>;

  /**
   * The uncommitted change set: the working tree against `HEAD`, one
   * provider-shaped entry per file.
   *
   * A separate operation rather than a ref passed to `changedFiles`, because
   * no ref names the working tree: what is under review here is precisely
   * what no commit holds -- staged and unstaged edits to tracked files, plus
   * every untracked file git is not ignoring. Removed files and files with no
   * textual hunks are dropped, as they are for a branch.
   */
  worktreeFiles(): Promise<ChangedFileEntry[]>;

  /**
   * A file's current text from the working tree, capped at `limit`
   * characters, or `null` when it cannot be read as text.
   */
  readFile(path: string, limit: number): Promise<string | null>;
}
