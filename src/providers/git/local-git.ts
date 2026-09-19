/**
 * The `GitReader` port over the `git` executable: diffs and files from one working tree, no credentials.
 * @packageDocumentation
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
import { expandUser } from "../config/paths";

/** Options for one git invocation. */
export interface GitRunOptions {
  /** Exit codes to accept as success: git answers through the exit code too (`diff` exits 1 for "differ"). */
  readonly allowedExitCodes?: readonly number[];
}

/**
 * Runs one git command in a directory.
 *
 * @returns stdout.
 * @throws {@link GitError} on a non-zero exit not in `allowedExitCodes`.
 */
export type GitRunner = (
  root: string,
  arguments_: readonly string[],
  options?: GitRunOptions,
) => Promise<string>;

/**
 * Checks the working tree to read is a git repository.
 *
 * @param root - The checkout: the repository owning `.review/config.yaml`, else the working directory.
 * @returns The absolute root.
 * @throws {@link GitError} when the path is not a directory or not a checkout.
 */
export function worktree(root: string): string {
  const absolute = resolve(expandUser(root));
  if (!existsSync(absolute) || !statSync(absolute).isDirectory()) {
    throw new GitError(`${absolute} is not a directory`);
  }
  if (!existsSync(join(absolute, ".git"))) {
    throw new GitError(
      `${absolute} is not a git repository. Branch review reads the diff from local git; run it inside a checkout.`,
    );
  }
  return absolute;
}

/**
 * The default runner: `git` on `PATH`. stdout is returned byte for byte; both pipes are drained with the
 * exit so a large diff cannot deadlock the child.
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

/** Paths as bytes, not C escapes, whatever the machine's git config says. */
const RAW_PATHS = ["-c", "core.quotePath=false"] as const;

/** `git diff` exits 1 when the sides differ. */
const DIFFERS: readonly number[] = [1];

/** `git rev-parse --verify --quiet` exits 1 when the ref is absent. */
const ABSENT_REF: readonly number[] = [1];

/** The empty side of an untracked file's diff. */
const DEV_NULL = "/dev/null";

/** Untracked files diffed at once; each is one `--no-index` subprocess. */
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

  /** The three-dot diff with rename detection, so a rename is one entry rather than a delete and an add. */
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
   * Everything `git status` would call dirty: tracked changes (staged and unstaged as one patch) plus
   * untracked, non-ignored files as added-file patches. Sorted by path.
   */
  async worktreeFiles(): Promise<ChangedFileEntry[]> {
    const against = await this.committedSide();
    const [tracked, untracked] = await Promise.all([
      this.trackedChanges(against),
      this.untrackedChanges(),
    ]);
    return [...tracked, ...untracked].toSorted((a, b) => compareCodePoints(a.filename, b.filename));
  }

  /** The file's text from the working tree, or `null` when unreadable (binary, deleted). */
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

  /** `HEAD`, or the empty tree in a repository with no commit yet. */
  private async committedSide(): Promise<string> {
    const head = await this.run(this.root, ["rev-parse", "--verify", "--quiet", "HEAD"], {
      allowedExitCodes: ABSENT_REF,
    });
    if (head.trim() !== "") return "HEAD";
    // The empty tree's hash in this repository's own object format (sha-1 or sha-256).
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
      "--",
    ]);
    return splitPatches(raw);
  }

  /** Every untracked, non-ignored file as an added-file patch; an embedded repository (trailing `/`) is dropped. */
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

  /** One untracked file as a patch against `/dev/null`; a file that cannot be diffed costs only itself. */
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
