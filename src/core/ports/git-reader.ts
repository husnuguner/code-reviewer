/**
 * The local-git port: branch review's diff source.
 *
 * Branch review compares a branch against a base from a working tree, so it
 * needs no repo provider and no credentials -- which is why it works against a
 * repository whose hosting system nobody has implemented, and against work
 * that has not been pushed. Reading git is an infrastructure concern; the
 * flow only needs these three operations.
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
   * A file's current text from the working tree, capped at `limit`
   * characters, or `null` when it cannot be read as text.
   */
  readFile(path: string, limit: number): Promise<string | null>;
}
