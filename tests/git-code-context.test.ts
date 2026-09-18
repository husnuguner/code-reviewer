/**
 * The git-backed code context reads at the branch, not the working tree, and
 * the pre-context reaches the model in a branch review end to end.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { execaSync } from "execa";
import { describe, expect, it } from "vitest";

import { type Finding } from "../src/core/domain/finding";
import { reviewBranch } from "../src/core/review/branch-review";
import { type ReviewFileInput } from "../src/core/review/file-reviewer";
import { type PerFileReviewer } from "../src/core/review/review-file";
import { DEFAULT_FILE_REVIEW_SETTINGS } from "../src/core/review/review-file";
import { GitCodeContext, parseGrep } from "../src/infra/git/git-code-context";
import { type GitRunner, LocalGitReader } from "../src/infra/git/local-git";

function git(root: string, ...arguments_: string[]): void {
  execaSync("git", arguments_, { cwd: root });
}

/** A runner that records its invocations and answers from one fake ref. */
function recorded(options: { listable?: boolean } = {}): {
  run: GitRunner;
  commands: () => string[];
} {
  const commands: string[] = [];
  const run: GitRunner = (_root, arguments_) => {
    commands.push(arguments_.join(" "));
    const [command] = arguments_;
    if (command === "ls-tree") {
      return options.listable === false
        ? Promise.reject(new Error("not a tree"))
        : Promise.resolve("src/a.ts\0src/b.ts\0");
    }
    if (command === "show") {
      return arguments_[1] === "feature:src/a.ts"
        ? Promise.resolve("export const a = 1;\n")
        : Promise.reject(new Error("no such path"));
    }
    return Promise.resolve("feature:src/b.ts:3:uses a\n");
  };
  return { run, commands: () => commands };
}

/**
 * `main` has a service and a caller; `feature` changes the service's export
 * and a route that imports it. The working tree is then switched back to
 * `main`, so anything read from the tree instead of the branch is stale.
 */
function repo(): string {
  const root = mkdtempSync(join(tmpdir(), "reviewer-context-"));
  git(root, "init", "-b", "main", "-q");
  git(root, "config", "user.email", "t@example.com");
  git(root, "config", "user.name", "Test");
  mkdirSync(join(root, "src", "api"), { recursive: true });
  mkdirSync(join(root, "src", "jobs"), { recursive: true });
  writeFileSync(
    join(root, "src", "service.ts"),
    "/** Totals the items. */\nexport function total(items: number[]): number {\n  return 0;\n}\n",
  );
  writeFileSync(
    join(root, "src", "jobs", "nightly.ts"),
    "import { total } from '../service';\ntotal([]);\n",
  );
  writeFileSync(join(root, "src", "api", "route.ts"), "export const GET = 1;\n");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "base");

  git(root, "checkout", "-q", "-b", "feature");
  writeFileSync(
    join(root, "src", "service.ts"),
    "/** Totals the items, taxed. */\nexport function total(items: number[], tax: number): number {\n  return tax;\n}\n",
  );
  writeFileSync(
    join(root, "src", "api", "route.ts"),
    "import { total } from '../service';\nexport const GET = total([], 1);\n",
  );
  git(root, "add", "-A");
  git(root, "commit", "-qm", "tax");
  git(root, "checkout", "-q", "main");
  return root;
}

describe("the git-backed code context", () => {
  it("reads a file at the branch, not from the working tree", async () => {
    const root = repo();
    const context = new GitCodeContext(root, "feature");
    expect(await context.readFile("src/service.ts")).toContain("tax: number");
    expect(await context.readFile("src/nope.ts")).toBeNull();
  });

  it("searches whole words at the branch with line numbers", async () => {
    const root = repo();
    const context = new GitCodeContext(root, "feature");
    const hits = await context.search("total", 10);
    expect(hits.map((h) => [h.path, h.line])).toEqual([
      ["src/api/route.ts", 1],
      ["src/api/route.ts", 2],
      ["src/jobs/nightly.ts", 1],
      ["src/jobs/nightly.ts", 2],
      ["src/service.ts", 2],
    ]);
    expect(await context.search("total", 2)).toHaveLength(2);
    expect(await context.search("nothing_like_this", 10)).toEqual([]);
    expect(await context.search("totals", 10)).toEqual([]); // whole word
  });

  it("parses grep rows and ignores anything else", () => {
    expect(parseGrep("feature:src/a.ts:12:export const a = 1;\nnoise\n", "feature")).toEqual([
      { path: "src/a.ts", line: 12, text: "export const a = 1;" },
    ]);
  });
});

/**
 * The ref is fixed for the run and this adapter is built once for it, so the
 * repeated questions the per-file gathering asks -- the same module resolved
 * from several files, the same symbol searched twice, a dozen candidate paths
 * that do not exist -- must not each become a subprocess.
 */
describe("what the code context asks git", () => {
  it("lists the ref once, then answers a missing path without asking git", async () => {
    const { run, commands } = recorded();
    const context = new GitCodeContext("/repo", "feature", run);
    expect(await context.readFile("src/nope.ts")).toBeNull();
    expect(await context.readFile("src/nope/index.ts")).toBeNull();
    expect(await context.readFile("src/a.ts")).toContain("export const a = 1;");
    expect(commands()).toEqual(["ls-tree -r -z --name-only feature", "show feature:src/a.ts"]);
  });

  it("reads a file and searches a needle once each, however often they are asked for", async () => {
    const { run, commands } = recorded();
    const context = new GitCodeContext("/repo", "feature", run);
    const [first, second] = await Promise.all([
      context.readFile("src/a.ts"),
      context.readFile("src/a.ts"),
    ]);
    expect(first).toBe(second);
    await context.readFile("src/a.ts");
    const hits = await context.search("a", 10);
    await context.search("a", 4);
    expect(hits).toEqual([{ path: "src/b.ts", line: 3, text: "uses a" }]);
    expect(commands().filter((command) => command.startsWith("show"))).toHaveLength(1);
    expect(commands().filter((command) => command.startsWith("grep"))).toHaveLength(1);
  });

  it("probes git as before when the ref cannot be listed", async () => {
    const { run, commands } = recorded({ listable: false });
    const context = new GitCodeContext("/repo", "feature", run);
    expect(await context.readFile("src/a.ts")).toContain("export const a = 1;");
    expect(await context.readFile("src/gone.ts")).toBeNull();
    // One failed listing, not one per read, and both reads still happened.
    expect(commands()).toEqual([
      "ls-tree -r -z --name-only feature",
      "show feature:src/a.ts",
      "show feature:src/gone.ts",
    ]);
  });
});

describe("pre-context in a branch review", () => {
  it("gives the model the imported module's signature and the symbol's other users", async () => {
    const root = repo();
    const prompts = new Map<string, string>();
    const reviewer: PerFileReviewer = {
      reviewFile: (input: ReviewFileInput): Promise<Finding[]> => {
        prompts.set(input.path, input.contextText ?? "");
        return Promise.resolve([]);
      },
    };
    await reviewBranch({
      base: "main",
      branch: "feature",
      reviewer,
      git: new LocalGitReader(root),
      settings: { ...DEFAULT_FILE_REVIEW_SETTINGS, maxFileChars: 100_000 },
      skills: null,
      maxConcurrentFiles: 2,
      codeContext: new GitCodeContext(root, "feature"),
    });
    // route.ts imports ../service: its exported signature (at the branch) is context.
    const route = prompts.get("src/api/route.ts") ?? "";
    expect(route).toContain("--- src/service.ts (imported as ../service)");
    expect(route).toContain("export function total(items: number[], tax: number): number {");
    // service.ts changed `total`: the other files using it are listed, itself excluded.
    const service = prompts.get("src/service.ts") ?? "";
    expect(service).toContain("- total: src/api/route.ts, src/jobs/nightly.ts");
    expect(service).not.toContain("src/service.ts, ");
  });

  it("gathers nothing when the cap is zero or no context is wired", async () => {
    const root = repo();
    const seen: string[] = [];
    const reviewer: PerFileReviewer = {
      reviewFile: (input: ReviewFileInput): Promise<Finding[]> => {
        seen.push(input.contextText ?? "");
        return Promise.resolve([]);
      },
    };
    const base = {
      base: "main",
      branch: "feature",
      reviewer,
      git: new LocalGitReader(root),
      skills: null,
      maxConcurrentFiles: 2,
    };
    await reviewBranch({
      ...base,
      settings: { ...DEFAULT_FILE_REVIEW_SETTINGS, maxContextChars: 0 },
      codeContext: new GitCodeContext(root, "feature"),
    });
    await reviewBranch({ ...base, settings: DEFAULT_FILE_REVIEW_SETTINGS });
    expect(seen.every((text) => text === "")).toBe(true);
  });
});
