/**
 * Local git as branch review's diff source, against a real throwaway
 * repository. git is not mocked: the point of reading local git is to let git
 * compute the diff, so a fake git would test the wrong thing.
 */

import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { GitError } from "../../../src/core/util/errors";
import {
  GIT_TIMEOUT_MS,
  LocalGitReader,
  runGit,
  worktree,
} from "../../../src/providers/git/local-git";
import { git } from "../../helpers/git";

/**
 * A repository with `main` and a `feature` branch that changed things:
 * feature modifies a.py, adds new.py, deletes gone.py, leaves same.py alone.
 */
function repo(): string {
  const root = mkdtempSync(join(tmpdir(), "reviewer-git-"));
  git(root, "init", "-b", "main", "-q");
  git(root, "config", "user.email", "t@example.com");
  git(root, "config", "user.name", "Test");
  writeFileSync(join(root, "a.py"), "one = 1\ntwo = 2\n");
  writeFileSync(join(root, "same.py"), "unchanged = True\n");
  writeFileSync(join(root, "gone.py"), "doomed = True\n");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "base");

  git(root, "checkout", "-q", "-b", "feature");
  writeFileSync(join(root, "a.py"), "one = 1\ntwo = 2\nthree = 3\n");
  writeFileSync(join(root, "new.py"), "fresh = True\n");
  rmSync(join(root, "gone.py"));
  git(root, "add", "-A");
  git(root, "commit", "-qm", "feature work");
  return root;
}

/**
 * A checkout with work in every uncommitted state there is: a tracked file
 * changed once in the index and again on disk, a file git has never seen, one
 * it is ignoring, one deleted, and a repository embedded in a subdirectory.
 */
function dirtyRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "reviewer-dirty-"));
  git(root, "init", "-b", "main", "-q");
  git(root, "config", "user.email", "t@example.com");
  git(root, "config", "user.name", "Test");
  writeFileSync(join(root, "a.py"), "one = 1\n");
  writeFileSync(join(root, "gone.py"), "doomed = True\n");
  writeFileSync(join(root, ".gitignore"), "ignored.py\n");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "base");

  writeFileSync(join(root, "a.py"), "one = 1\nstaged = 2\n");
  git(root, "add", "a.py");
  writeFileSync(join(root, "a.py"), "one = 1\nstaged = 2\nunstaged = 3\n");
  writeFileSync(join(root, "new.py"), "fresh = True\n");
  writeFileSync(join(root, "ignored.py"), "secret = True\n");
  rmSync(join(root, "gone.py"));
  mkdirSync(join(root, "vendored"));
  git(join(root, "vendored"), "init", "-b", "main", "-q");
  writeFileSync(join(root, "vendored", "inner.py"), "theirs = True\n");
  return root;
}

describe("the working tree", () => {
  it("refuses a directory that is not a repository", () => {
    const plain = mkdtempSync(join(tmpdir(), "reviewer-plain-"));
    expect(() => worktree(plain)).toThrow(GitError);
    expect(() => worktree(plain)).toThrow(/not a git repository/u);
  });

  it("refuses a missing directory", () => {
    expect(() => worktree(join(tmpdir(), "reviewer-does-not-exist"))).toThrow(/not a directory/u);
  });

  it("accepts the repository root", () => {
    const root = repo();
    expect(worktree(root)).toBe(root);
  });
});

describe("what git reports", () => {
  it("finds the merge-base of two related branches", async () => {
    const reader = new LocalGitReader(repo());
    const sha = await reader.mergeBase("main", "feature");
    expect(sha).toMatch(/^[0-9a-f]{40}$/u);
  });

  it("reads an unrelated pair as no merge-base rather than failing", async () => {
    const reader = new LocalGitReader(repo());
    expect(await reader.mergeBase("main", "no-such-branch")).toBeNull();
  });

  it("reports every changed file with its status, the removed one included, and not the untouched", async () => {
    // A removed file is part of the change: selection skips it with a reason, and a removed policy file
    // must still reach the warning.
    const reader = new LocalGitReader(repo());
    const files = await reader.changedFiles("main", "feature");
    expect(files.map((f) => [f.filename, f.status])).toEqual([
      ["a.py", "modified"],
      ["gone.py", "removed"],
      ["new.py", "added"],
    ]);
    expect(files[0]?.patch).toContain("+three = 3");
  });

  it("reads git's own diff whatever external diff program the machine configured", async () => {
    // `diff.external` runs for a plain `git diff`; its output is not a patch the parser -- or the model --
    // should be handed.
    const root = repo();
    const external = join(root, "..", `external-diff-${String(Date.now())}.sh`);
    writeFileSync(external, "#!/bin/sh\necho 'EXTERNAL DIFF'\n", { mode: 0o755 });
    git(root, "config", "diff.external", external);
    const files = await new LocalGitReader(root).changedFiles("main", "feature");
    expect(files.map((f) => f.filename)).toContain("a.py");
    expect(files.find((f) => f.filename === "a.py")?.patch).toContain("+three = 3");
    expect(files.some((f) => f.patch.includes("EXTERNAL DIFF"))).toBe(false);
  });

  it("knows which refs name a commit, and refuses an option-shaped one", async () => {
    const reader = new LocalGitReader(repo());
    expect(await reader.hasCommit("main")).toBe(true);
    expect(await reader.hasCommit("develop")).toBe(false);
    expect(await reader.hasCommit("--output=/tmp/x")).toBe(false);
    expect(await reader.hasCommit("")).toBe(false);
  });

  it("takes the remote's default branch as the base, else main, else master, else none", async () => {
    const root = repo();
    expect(await new LocalGitReader(root).defaultBase()).toBe("main");
    const clone = mkdtempSync(join(tmpdir(), "reviewer-clone-"));
    git(clone, "clone", "-q", root, ".");
    expect(await new LocalGitReader(clone).defaultBase()).toBe("origin/feature");
    git(root, "branch", "-q", "-m", "main", "master");
    expect(await new LocalGitReader(root).defaultBase()).toBe("master");
    git(root, "branch", "-q", "-m", "master", "trunk");
    expect(await new LocalGitReader(root).defaultBase()).toBeNull();
  });

  it("reads a file's text at a commit, whatever the working tree holds", async () => {
    const root = repo();
    writeFileSync(join(root, "a.py"), "edited, not committed\n");
    const reader = new LocalGitReader(root);
    expect(await reader.readFileAt("HEAD", "a.py")).toBe("one = 1\ntwo = 2\nthree = 3\n");
    expect(await reader.readFileAt("HEAD", "gone.py")).toBeNull();
    expect(await reader.readFileAt("main", "gone.py")).toBe("doomed = True\n");
  });

  it("reads a changed file's current text, whole", async () => {
    const reader = new LocalGitReader(repo());
    expect(await reader.readFile("a.py")).toBe("one = 1\ntwo = 2\nthree = 3\n");
    expect(await reader.readFile("gone.py")).toBeNull();
  });

  it("reports no files when the branch is the base", async () => {
    const reader = new LocalGitReader(repo());
    expect(await reader.changedFiles("main", "main")).toEqual([]);
  });

  it("reports nothing uncommitted in a clean checkout", async () => {
    expect(await new LocalGitReader(repo()).worktreeFiles()).toEqual([]);
  });

  it("stops a git command that does not finish, as a GitError that says so", async () => {
    // A git waiting on a lock or a prompt used to hold the run, and a CI job, until its own timeout.
    const root = repo();
    const started = performance.now();
    const slow = runGit(root, ["-c", "alias.slow=!sleep 3", "slow"], { timeoutMs: 200 });
    await expect(slow).rejects.toThrow(GitError);
    await expect(slow).rejects.toThrow(/did not finish within 0\.2s and was stopped/u);
    // Not held for the three seconds by the `sleep` git started, which keeps the pipes open.
    expect(performance.now() - started).toBeLessThan(2500);
    expect(GIT_TIMEOUT_MS).toBeGreaterThanOrEqual(60_000);
  });

  it("surfaces a failing git command as a GitError", async () => {
    const reader = new LocalGitReader(repo());
    await expect(reader.changedFiles("main", "no-such-branch")).rejects.toBeInstanceOf(GitError);
    await expect(reader.changedFiles("main", "no-such-branch")).rejects.toThrow(
      /git .*diff .* failed/u,
    );
  });
});

describe("what the working tree reports", () => {
  it("reports the changed and the new files, and nothing git is ignoring", async () => {
    const files = await new LocalGitReader(dirtyRepo()).worktreeFiles();
    // `ignored.py` is excluded, `gone.py` is reported as removed for selection to skip,
    // and `vendored/` belongs to the repository embedded in it.
    expect(files.map((f) => [f.filename, f.status])).toEqual([
      ["a.py", "modified"],
      ["gone.py", "removed"],
      ["new.py", "added"],
    ]);
  });

  it("shows staged and unstaged work on one file as the one change it is", async () => {
    const files = await new LocalGitReader(dirtyRepo()).worktreeFiles();
    const patch = files.find((f) => f.filename === "a.py")?.patch ?? "";
    // Staging is a step towards a commit, not a verdict on what is finished:
    // a review that saw one side would review a change nobody made.
    expect(patch).toContain("+staged = 2");
    expect(patch).toContain("+unstaged = 3");
  });

  it("reads a repository with no commit at all against the empty tree", async () => {
    // `git diff HEAD` cannot be asked here; the answer is still "all of it".
    const root = mkdtempSync(join(tmpdir(), "reviewer-unborn-"));
    git(root, "init", "-b", "main", "-q");
    git(root, "config", "user.email", "t@example.com");
    git(root, "config", "user.name", "Test");
    writeFileSync(join(root, "staged.py"), "x = 1\n");
    git(root, "add", "-A");
    writeFileSync(join(root, "staged.py"), "x = 1\ny = 2\n");
    writeFileSync(join(root, "loose.py"), "z = 3\n");
    const files = await new LocalGitReader(root).worktreeFiles();
    expect(files.map((f) => [f.filename, f.status])).toEqual([
      ["loose.py", "added"],
      ["staged.py", "added"],
    ]);
    expect(files.find((f) => f.filename === "staged.py")?.patch).toContain("+y = 2");
  });

  it("names an untracked file as git stores it, not as git would print it", async () => {
    // Quoted (`"\303\274.py"`), the path would name no file on disk, and
    // every finding anchored to it would point nowhere.
    const root = dirtyRepo();
    writeFileSync(join(root, "ünï file.py"), "uni = 1\n");
    const files = await new LocalGitReader(root).worktreeFiles();
    expect(files.map((f) => f.filename)).toContain("ünï file.py");
  });

  it("skips an untracked file git cannot diff rather than losing the run", async () => {
    // A path listed and then gone is a property of a working tree; the other
    // files still get their review.
    const root = dirtyRepo();
    const reader = new LocalGitReader(root, async (directory, arguments_, options) => {
      const out = await runGit(directory, arguments_, options);
      return arguments_.includes("--others") ? `${out}vanished.py\u{0}` : out;
    });
    const files = await reader.worktreeFiles();
    expect(files.map((f) => f.filename)).toEqual(["a.py", "gone.py", "new.py"]);
  });
});
