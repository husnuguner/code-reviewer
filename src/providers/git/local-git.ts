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

import pLimit from "p-limit";

import { splitPatches } from "../../core/diff/patch-set";
import { type ChangedFileEntry } from "../../core/domain/changed-file";
import { type GitReader } from "../../core/ports/git-reader";
import { type Logger, NULL_LOGGER } from "../../core/ports/logger";
import { GitError, errorMessage } from "../../core/util/errors";
import { compareCodePoints, cutToLength, show } from "../../core/util/text";
import { expandUser } from "../catalog/paths";

/** What a git command may exit with without having failed. */
export interface GitRunOptions {
  /**
   * Exit codes to accept as success, stdout and all.
   *
   * Needed because git reports answers through the exit code as well as
   * through stdout: `diff` exits 1 for "these differ", which is the *normal*
   * outcome when the question is "what changed", and `rev-parse --verify`
   * exits 1 for "no such ref", which is an answer rather than a breakage.
   * Only a code nobody named is a failure.
   */
  readonly allowedExitCodes?: readonly number[];
}

/** Runs one git command in a directory and returns its stdout, or throws `GitError`. */
export type GitRunner = (
  root: string,
  arguments_: readonly string[],
  options?: GitRunOptions,
) => Promise<string>;

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

/**
 * The default runner: the `git` executable on `PATH`.
 *
 * stdout is returned byte for byte -- a patch's final newline is part of the
 * patch. Both pipes are drained together with the exit, so a large diff
 * cannot deadlock the child on a full pipe.
 */
export const runGit: GitRunner = async (root, arguments_, options) => {
  const command = `git ${arguments_.join(" ")}`;
  let child: Bun.Subprocess<"ignore", "pipe", "pipe">;
  try {
    child = Bun.spawn(["git", ...arguments_], {
      cwd: root,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch (error) {
    throw new GitError(`${command} could not start: ${errorMessage(error)}`);
  }
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0 && !(options?.allowedExitCodes ?? []).includes(exitCode)) {
    throw new GitError(`${command} failed: ${stderr.trim()}`);
  }
  return stdout;
};

/**
 * `-c core.quotePath=false`: a path arrives as its bytes, not as C escapes.
 *
 * git otherwise prints a non-ASCII path quoted (`"src/\303\274.ts"`), and the
 * diff parser would report *that* as the file's name -- a path no reader can
 * open and no anchor can match, so the file's findings would point nowhere.
 * Passed per invocation rather than assumed of the repository, so a machine
 * whose git config differs cannot change what a review sees.
 */
const RAW_PATHS = ["-c", "core.quotePath=false"] as const;

/** `git diff` exits 1 when the two sides differ, which is what we asked. */
const DIFFERS: readonly number[] = [1];

/** `git rev-parse --verify --quiet` exits 1 when the ref is simply not there. */
const ABSENT_REF: readonly number[] = [1];

/** The empty side of an untracked file's diff. */
const DEV_NULL = "/dev/null";

/**
 * Untracked files whose patches are read at once.
 *
 * `git diff --no-index` compares exactly two paths, so an untracked file
 * costs one subprocess and a change set of them cannot be one call. A small
 * bound is what keeps a new directory of fifty files from being fifty
 * round-trips in series, without handing the machine a process per file.
 */
const UNTRACKED_AT_ONCE = 8;

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
      ...RAW_PATHS,
      "diff",
      `--unified=${this.context}`,
      "--find-renames",
      "--no-color",
      `${base}...${branch}`,
    ]);
    return splitPatches(raw);
  }

  /**
   * The uncommitted change set: everything `git status` would call dirty,
   * as one diff.
   *
   * Two questions, because git answers them separately and the review needs
   * one change set:
   *
   * - **Tracked files** are `git diff HEAD`, which is staged *and* unstaged
   *   work in one patch. Staging is a step on the way to a commit, not a
   *   judgement about what is finished, so a reviewer that saw only one side
   *   of it would review a change set the author never made.
   * - **Untracked files** are invisible to every `git diff` against a ref, so
   *   each is read as a patch against nothing. They are where a new module
   *   arrives, which is the code most worth reviewing before it is committed.
   *
   * Sorted by path, so the change set reads the same twice and does not
   * depend on which of the two questions answered first.
   */
  async worktreeFiles(): Promise<ChangedFileEntry[]> {
    const against = await this.committedSide();
    const [tracked, untracked] = await Promise.all([
      this.trackedChanges(against),
      this.untrackedChanges(),
    ]);
    return [...tracked, ...untracked].toSorted((a, b) => compareCodePoints(a.filename, b.filename));
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

  /**
   * What the tracked files are compared against: `HEAD`, or the empty tree in
   * a repository that has no commit yet.
   *
   * A fresh `git init` has no `HEAD` to name, and `git diff HEAD` there fails
   * with git's own "ambiguous argument" -- an error about a ref, for a run
   * whose question was "what have I written". Against the empty tree the
   * answer is the honest one: everything the tree has is new.
   */
  private async committedSide(): Promise<string> {
    const head = await this.run(this.root, ["rev-parse", "--verify", "--quiet", "HEAD"], {
      allowedExitCodes: ABSENT_REF,
    });
    if (head.trim() !== "") return "HEAD";
    // `--stdin` with no stdin: the hash of an empty tree, in this
    // repository's own object format, rather than the sha-1 constant every
    // sha-256 repository would reject.
    const empty = await this.run(this.root, ["hash-object", "-t", "tree", "--stdin"]);
    const tree = empty.trim();
    this.log.debug(`No HEAD in ${this.root}; comparing the working tree against the empty tree.`);
    return tree;
  }

  /** Staged and unstaged work on tracked files, as one patch. */
  private async trackedChanges(against: string): Promise<ChangedFileEntry[]> {
    const raw = await this.run(this.root, [
      ...RAW_PATHS,
      "diff",
      `--unified=${this.context}`,
      "--find-renames",
      "--no-color",
      against,
      // Ends the revisions, so a file named like a ref cannot be read as one.
      "--",
    ]);
    return splitPatches(raw);
  }

  /**
   * Every untracked file git is not ignoring, each as an added-file patch.
   *
   * `--exclude-standard` is what makes this usable at all: without it the
   * change set would be `node_modules`. A path git reports with a trailing
   * slash is an untracked *directory* it declined to descend into -- an
   * embedded repository -- and its files are that repository's work, not this
   * one's, so it is dropped rather than diffed.
   */
  private async untrackedChanges(): Promise<ChangedFileEntry[]> {
    const out = await this.run(this.root, ["ls-files", "--others", "--exclude-standard", "-z"]);
    const paths = out.split("\0").filter((path) => path !== "" && !path.endsWith("/"));
    if (paths.length === 0) return [];
    const limit = pLimit(UNTRACKED_AT_ONCE);
    const patches = await Promise.all(
      paths.map((path) => limit(async () => this.untrackedPatch(path))),
    );
    return patches.flat();
  }

  /**
   * One untracked file as a patch against nothing (`--no-index`), so git
   * decides what a new file's diff looks like -- its mode, its binary-ness,
   * its missing final newline -- rather than this module guessing.
   *
   * A file that cannot be diffed costs itself and nothing else: a symlink to
   * nowhere or a path that vanished between the listing and the read is a
   * property of a working tree, not a reason to abandon the review.
   */
  private async untrackedPatch(path: string): Promise<ChangedFileEntry[]> {
    try {
      const raw = await this.run(
        this.root,
        [
          ...RAW_PATHS,
          "diff",
          "--no-index",
          `--unified=${this.context}`,
          "--no-color",
          "--",
          DEV_NULL,
          path,
        ],
        { allowedExitCodes: DIFFERS },
      );
      return splitPatches(raw);
    } catch (error) {
      this.log.debug(`No patch for untracked ${path}: ${errorMessage(error)}`);
      return [];
    }
  }
}
