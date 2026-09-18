/**
 * Branch review's diff source: local git, read through the `git` executable.
 *
 * The payoff beyond speed is reach: this module needs no credentials and no
 * provider, so branch review works against a repository whose hosting system
 * nobody has implemented, and against work that has not been pushed.
 *
 * Output mirrors what a provider's `changedFiles` returns (`filename` /
 * `status` / `patch`), so the per-file review loop cannot tell the two sources
 * apart.
 */

import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { execa } from "execa";

import { type ChangedFileEntry } from "../../core/domain/changed-file";
import { type GitReader } from "../../core/ports/git-reader";
import { type Logger, NULL_LOGGER } from "../../core/ports/logger";
import { splitPatches } from "../../core/review/patch-set";
import { GitError, errorMessage } from "../../core/util/errors";
import { cutToLength, show } from "../../core/util/text";
import { expandUser } from "../config/paths";

/** Runs one git command in a directory and returns its stdout, or throws `GitError`. */
export type GitRunner = (root: string, arguments_: readonly string[]) => Promise<string>;

/**
 * The working tree to read, and proof that it is one.
 *
 * Defaults to the current directory: branch review is the pre-pull-request
 * check you run from inside the repository you are working in. An explicit
 * path (`REVIEW_LOCAL_PATH`) overrides it, which is why that setting lives in
 * the environment rather than in `config.yaml` -- it is machine-specific and
 * the catalogue is meant to be shareable.
 */
export function worktree(localPath = "", cwd: string = process.cwd()): string {
  const root = localPath === "" ? cwd : resolve(expandUser(localPath));
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new GitError(`${root} is not a directory`);
  }
  if (!existsSync(join(root, ".git"))) {
    throw new GitError(
      `${root} is not a git repository. Branch review reads the diff from local git; run it inside a checkout or set REVIEW_LOCAL_PATH.`,
    );
  }
  return root;
}

/** The default runner: the `git` executable on `PATH`. */
export const runGit: GitRunner = async (root, arguments_) => {
  const result = await execa("git", arguments_, {
    cwd: root,
    reject: false,
    stripFinalNewline: false,
  });
  if (result.exitCode !== 0) {
    const detail = result.stderr.trim();
    throw new GitError(`git ${arguments_.join(" ")} failed: ${detail}`);
  }
  return result.stdout;
};

/** Reads a branch's diff and files from one working tree. */
export class LocalGitReader implements GitReader {
  private readonly log: Logger;

  constructor(
    readonly root: string,
    private readonly run: GitRunner = runGit,
    logger: Logger = NULL_LOGGER,
    private readonly context = 3,
  ) {
    this.log = logger.child("review.local_git");
  }

  async mergeBase(base: string, branch: string): Promise<string | null> {
    let out: string;
    try {
      out = await this.run(this.root, ["merge-base", base, branch]);
    } catch (error) {
      const detail = errorMessage(error);
      this.log.warn(`No merge-base for ${show(base)} and ${show(branch)}: ${detail}`);
      return null;
    }
    const sha = out.trim();
    return sha === "" ? null : sha;
  }

  /**
   * Three-dot (`base...branch`) so that commits `base` gained after the fork
   * are not reported as this branch's work. Rename detection is on: a renamed
   * file is reported once as a rename rather than twice as a delete and an add.
   */
  async changedFiles(base: string, branch: string): Promise<ChangedFileEntry[]> {
    const raw = await this.run(this.root, [
      "diff",
      `--unified=${this.context}`,
      "--find-renames",
      "--no-color",
      `${base}...${branch}`,
    ]);
    return splitPatches(raw);
  }

  /**
   * Unreadable is not exceptional here: the file may be binary, or deleted
   * since the diff was taken. Context is a bonus for the prompt, so its
   * absence must not cost the file its review.
   */
  async readFile(path: string, limit: number): Promise<string | null> {
    try {
      const bytes = await readFile(join(this.root, path));
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      return cutToLength(text, limit);
    } catch (error) {
      const detail = errorMessage(error);
      this.log.debug(`No worktree content for ${path}: ${detail}`);
      return null;
    }
  }
}
