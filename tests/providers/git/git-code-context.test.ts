/**
 * The git-backed code context reads at the branch, not the working tree, and
 * the pre-context reaches the model in a branch review end to end.
 */

import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type Finding } from "../../../src/core/domain/finding";
import { HEAD, reviewBranch } from "../../../src/core/review/branch-review";
import { type ReviewFileInput } from "../../../src/core/review/file-reviewer";
import { type PerFileReviewer } from "../../../src/core/review/review-file";
import { DEFAULT_FILE_REVIEW_SETTINGS } from "../../../src/core/review/review-file";
import { GitCodeContext, parseGrep } from "../../../src/providers/git/git-code-context";
import { type GitRunner, LocalGitReader } from "../../../src/providers/git/local-git";
import { builtinLanguages } from "../../../src/providers/languages/builtin";
import { git } from "../../helpers/git";

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
    return Promise.resolve(`${grepRow("feature", "src/b.ts", 3, "uses a")}\n`);
  };
  return { run, commands: () => commands };
}

/** The delimiter `git grep -z` puts after the path and after the line number. */
const NUL = "\u{0}";

/** One row as `git grep -z` prints it: `<ref>:<path>\0<line>\0<text>`. */
function grepRow(reference: string, path: string, line: number, text: string): string {
  return `${reference}:${path}${NUL}${String(line)}${NUL}${text}`;
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
    const row = grepRow("feature", "src/a.ts", 12, "export const a = 1;");
    expect(parseGrep(`${row}\nnoise\n`, "feature")).toEqual([
      { path: "src/a.ts", line: 12, text: "export const a = 1;" },
    ]);
  });

  it("reads a path containing a colon, which is why -z is asked for", () => {
    // Colon-separated, `src/a:12:b.ts:5:code` reads as line 12 of `src/a`:
    // a file name that does not exist, handed to the model as fact. A NUL
    // cannot occur in a path, so there is nothing left to guess at.
    const row = grepRow("feature", "src/a:12:b.ts", 5, "code");
    expect(parseGrep(`${row}\n`, "feature")).toEqual([
      { path: "src/a:12:b.ts", line: 5, text: "code" },
    ]);
  });

  it("keeps a colon in the matched text, and drops a row it cannot read", () => {
    const row = grepRow("feature", "a.ts", 7, "const u = 'http://x';");
    expect(parseGrep(`${row}\n`, "feature")).toEqual([
      { path: "a.ts", line: 7, text: "const u = 'http://x';" },
    ]);
    // A line number that is not one, and a row with no path at all.
    const malformed = `feature:a.ts${NUL}nope${NUL}code\nfeature:${NUL}1${NUL}x\n`;
    expect(parseGrep(malformed, "feature")).toEqual([]);
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

  it("asks grep for the exact shape it parses, and caps the output per file", async () => {
    // Pinned as one command because two of these flags are not preferences.
    // `-z` is what `parseGrep` reads: drop it and the rows come back
    // colon-separated and are silently split in the wrong place. `-m` bounds how much a
    // common identifier pushes through the pipe; it never changes *which*
    // files are reported, which is the only thing the caller keeps, so no
    // behavioural test can notice if it disappears.
    const { run, commands } = recorded();
    await new GitCodeContext("/repo", "feature", run).search("total", 10);
    expect(commands().filter((command) => command.startsWith("grep"))).toEqual([
      "grep -n -z -F -I -w -m 8 -- total feature",
    ]);
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
    // The reviewed side is the checkout, so the branch is checked out first.
    const root = repo();
    git(root, "checkout", "-q", "feature");
    const prompts = new Map<string, string>();
    const reviewer: PerFileReviewer = {
      reviewFile: (input: ReviewFileInput): Promise<Finding[]> => {
        prompts.set(input.path, input.contextText ?? "");
        return Promise.resolve([]);
      },
    };
    await reviewBranch({
      base: "main",
      reviewer,
      git: new LocalGitReader(root),
      settings: DEFAULT_FILE_REVIEW_SETTINGS,
      skills: null,
      maxConcurrentFiles: 2,
      codeContext: new GitCodeContext(root, HEAD),
      languages: builtinLanguages(),
    });
    // route.ts imports ../service: its exported signature (at the checkout) is context.
    const route = prompts.get("src/api/route.ts") ?? "";
    expect(route).toContain("--- src/service.ts (imported as ../service)");
    expect(route).toContain("export function total(items: number[], tax: number): number {");
    // service.ts changed `total`: the other files using it are listed, itself excluded.
    const service = prompts.get("src/service.ts") ?? "";
    expect(service).toContain("- total: src/api/route.ts, src/jobs/nightly.ts");
    expect(service).not.toContain("src/service.ts, ");
  });

  it("reads every file as plain text when no language is wired: Related only, no Definitions or Usages", async () => {
    const root = repo();
    git(root, "checkout", "-q", "feature");
    const prompts = new Map<string, string>();
    const reviewer: PerFileReviewer = {
      reviewFile: (input: ReviewFileInput): Promise<Finding[]> => {
        prompts.set(input.path, input.contextText ?? "");
        return Promise.resolve([]);
      },
    };
    await reviewBranch({
      base: "main",
      reviewer,
      git: new LocalGitReader(root),
      settings: DEFAULT_FILE_REVIEW_SETTINGS,
      skills: null,
      maxConcurrentFiles: 2,
      codeContext: new GitCodeContext(root, HEAD),
    });
    const route = prompts.get("src/api/route.ts") ?? "";
    expect(route).not.toContain("Definitions of modules");
    expect(prompts.get("src/service.ts") ?? "").not.toContain("Other files that mention");
  });

  it("gathers nothing when the cap is zero or no context is wired", async () => {
    const root = repo();
    git(root, "checkout", "-q", "feature");
    const seen: string[] = [];
    const reviewer: PerFileReviewer = {
      reviewFile: (input: ReviewFileInput): Promise<Finding[]> => {
        seen.push(input.contextText ?? "");
        return Promise.resolve([]);
      },
    };
    const base = {
      base: "main",
      reviewer,
      git: new LocalGitReader(root),
      skills: null,
      maxConcurrentFiles: 2,
    };
    await reviewBranch({
      ...base,
      settings: { ...DEFAULT_FILE_REVIEW_SETTINGS, maxContextChars: 0 },
      codeContext: new GitCodeContext(root, HEAD),
    });
    await reviewBranch({ ...base, settings: DEFAULT_FILE_REVIEW_SETTINGS });
    expect(seen.every((text) => text === "")).toBe(true);
  });
});
