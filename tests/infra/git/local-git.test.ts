/**
 * Local git as branch review's diff source, against a real throwaway
 * repository. git is not mocked: the point of reading local git is to let git
 * compute the diff, so a fake git would test the wrong thing.
 */

import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { GitError } from "../../../src/core/util/errors";
import { LocalGitReader, worktree } from "../../../src/infra/git/local-git";
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

describe("the working tree", () => {
  it("refuses a directory that is not a repository", () => {
    const plain = mkdtempSync(join(tmpdir(), "reviewer-plain-"));
    expect(() => worktree(plain)).toThrow(GitError);
    expect(() => worktree(plain)).toThrow(/not a git repository/u);
  });

  it("refuses a missing directory", () => {
    expect(() => worktree(join(tmpdir(), "reviewer-does-not-exist"))).toThrow(/not a directory/u);
  });

  it("accepts the repository root, and defaults to the cwd", () => {
    const root = repo();
    expect(worktree(root)).toBe(root);
    expect(worktree("", root)).toBe(root);
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

  it("reports the modified and added files, not the deleted or untouched ones", async () => {
    const reader = new LocalGitReader(repo());
    const files = await reader.changedFiles("main", "feature");
    expect(files.map((f) => [f.filename, f.status])).toEqual([
      ["a.py", "modified"],
      ["new.py", "added"],
    ]);
    expect(files[0]?.patch).toContain("+three = 3");
  });

  it("reads a changed file's current text, capped", async () => {
    const reader = new LocalGitReader(repo());
    expect(await reader.readFile("a.py", 100_000)).toBe("one = 1\ntwo = 2\nthree = 3\n");
    expect(await reader.readFile("a.py", 7)).toBe("one = 1");
    expect(await reader.readFile("gone.py", 100)).toBeNull();
  });

  it("reports no files when the branch is the base", async () => {
    const reader = new LocalGitReader(repo());
    expect(await reader.changedFiles("main", "main")).toEqual([]);
  });

  it("surfaces a failing git command as a GitError", async () => {
    const reader = new LocalGitReader(repo());
    await expect(reader.changedFiles("main", "no-such-branch")).rejects.toBeInstanceOf(GitError);
    await expect(reader.changedFiles("main", "no-such-branch")).rejects.toThrow(
      /git diff .* failed/u,
    );
  });
});
