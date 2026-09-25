/**
 * The local-git port: the diff source for a branch or working-tree review.
 * @packageDocumentation
 */

import { type ChangedFileEntry } from "../domain/changed-file";

/** Reads a working tree's diffs and files. */
export interface GitReader {
  /** The working tree's root directory. */
  readonly root: string;

  /**
   * Where `branch` forked from `base`.
   *
   * @returns The merge-base, or `null` when there is none: unrelated histories, or a shallow clone.
   */
  mergeBase(base: string, branch: string): Promise<string | null>;

  /** Whether `reference` names a commit here: a branch, a tag, a sha, `origin/main`. */
  hasCommit(reference: string): Promise<boolean>;

  /**
   * The branch a change here would merge into, when nobody named one: the remote's default branch
   * (`origin/HEAD`), else a local `main`, else `master`.
   *
   * @returns The ref, or `null` when none of them exists.
   */
  defaultBase(): Promise<string | null>;

  /**
   * The three-dot diff `base...branch`, one entry per file.
   *
   * @remarks Every file git names is reported with its status, removed and binary ones included.
   */
  changedFiles(base: string, branch: string): Promise<ChangedFileEntry[]>;

  /**
   * The working tree against `HEAD`: staged and unstaged edits plus untracked, non-ignored files.
   *
   * @remarks A separate operation because no ref names the working tree.
   */
  worktreeFiles(): Promise<ChangedFileEntry[]>;

  /**
   * A file's current text from the working tree, whole.
   *
   * @returns The text, or `null` when it cannot be read as text.
   */
  readFile(path: string): Promise<string | null>;

  /**
   * A file's text at a commit, whole: what a review of that commit reads, whatever the working tree holds.
   *
   * @returns The text, or `null` when the commit has no such file or it is not text.
   */
  readFileAt(reference: string, path: string): Promise<string | null>;
}
