/**
 * Branch review against real local git, in a throwaway repository.
 *
 * git is not mocked. The whole point of reading local git is to let git
 * compute the diff, so a fake git would test the wrong thing -- these build an
 * actual repository, actually branch it, and read what git reports.
 */

import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type Finding, finding } from "../../../src/core/domain/finding";
import { type BranchReviewRecord } from "../../../src/core/ports/review-reporter";
import { type SkillMatcher } from "../../../src/core/ports/skill-matcher";
import {
  type BranchReviewOptions,
  branchReviewText,
  iterBranchReview,
  previewBranch,
  reviewBranch,
  streamBranchReview,
} from "../../../src/core/review/branch-review";
import { type ReviewFileInput } from "../../../src/core/review/file-reviewer";
import {
  DEFAULT_FILE_REVIEW_SETTINGS,
  type PerFileReviewer,
} from "../../../src/core/review/review-file";
import { type Verdict, type VerifyInput } from "../../../src/core/review/verify";
import { sortedByCodePoint } from "../../../src/core/util/text";
import { LocalGitReader } from "../../../src/providers/git/local-git";
import { loadFixture } from "../../contracts/fixtures";
import { git } from "../../helpers/git";

/**
 * A repository with `main` and a `feature` branch that changed things:
 * feature modifies a.py, adds new.py, deletes gone.py, leaves same.py alone.
 */
function repo(): string {
  const root = mkdtempSync(join(tmpdir(), "reviewer-branch-"));
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

/** Reports one finding per file, on that file's first added line. */
class FakeReviewer implements PerFileReviewer {
  readonly seen: string[] = [];
  readonly contents = new Map<string, string | null>();
  readonly anchorIndex = new Map<string, [number, string][]>();

  constructor(private readonly example = "") {}

  reviewFile(input: ReviewFileInput): Promise<Finding[]> {
    this.seen.push(input.path);
    this.contents.set(input.path, input.content);
    this.anchorIndex.set(
      input.path,
      (input.anchorIndex ?? []).map(([n, t]) => [n, t]),
    );
    return Promise.resolve([
      finding({
        line: Math.min(...input.allowedLines),
        severity: "bug",
        body: "boom",
        example: this.example,
      }),
    ]);
  }
}

/** Minimal registry stand-in: maps every path to fixed skill names. */
class FakeSkills implements SkillMatcher {
  constructor(private readonly names: readonly string[]) {}

  skillsFor(): ReturnType<SkillMatcher["skillsFor"]> {
    return this.names.map((name) => ({
      name,
      globs: ["**"],
      body: "",
      source: "repo",
      description: "",
    }));
  }

  renderFor(): string {
    return this.names.length > 0 ? "skills-text" : "";
  }
}

/** Options over a real git reader for `root`, with a recording reviewer unless one is given. */
function options<R extends PerFileReviewer = FakeReviewer>(
  root: string,
  overrides: Partial<BranchReviewOptions> & { reviewer?: R } = {},
): BranchReviewOptions & { reviewer: R } {
  const reviewer = overrides.reviewer ?? (new FakeReviewer() as PerFileReviewer as R);
  return {
    base: "main",
    branch: "feature",
    git: new LocalGitReader(root),
    settings: { ...DEFAULT_FILE_REVIEW_SETTINGS, maxFileChars: 100_000 },
    skills: null,
    maxConcurrentFiles: 4,
    ...overrides,
    reviewer,
  };
}

// -- what git reports ------------------------------------------------------

describe("what git reports", () => {
  it("reviews changed files and leaves the rest alone", async () => {
    const o = options(repo());
    const result = await reviewBranch(o);
    // a.py modified and new.py added; same.py untouched and gone.py deleted.
    expect(sortedByCodePoint(o.reviewer.seen)).toEqual(["a.py", "new.py"]);
    expect(result.files_reviewed).toBe(2);
    expect(o.reviewer.seen).not.toContain("gone.py");
  });

  it("gives a modified file its worktree content as context, an added file none", async () => {
    const o = options(repo());
    await reviewBranch(o);
    expect(o.reviewer.contents.get("a.py")).toBe("one = 1\ntwo = 2\nthree = 3\n");
    // Its diff already is the whole file, so attaching it again would only
    // duplicate it in the prompt.
    expect(o.reviewer.contents.get("new.py")).toBeNull();
  });

  it("builds the anchor index from the git diff", async () => {
    const o = options(repo());
    await reviewBranch(o);
    const index = o.reviewer.anchorIndex.get("a.py") ?? [];
    expect(index.map(([n, t]) => [n, t.trim()])).toContainEqual([3, "three = 3"]);
  });

  it("carries the line git reported on each finding", async () => {
    const result = await reviewBranch(options(repo()));
    const byPath = new Map(result.findings.map((f) => [f.path, f]));
    expect(byPath.get("a.py")?.line).toBe(3);
    expect(byPath.get("a.py")?.anchor).toBe("exact");
  });

  it("skips a file matching an exclude glob entirely", async () => {
    const o = options(repo(), {
      settings: { ...DEFAULT_FILE_REVIEW_SETTINGS, exclude: ["new.py"] },
    });
    const result = await reviewBranch(o);
    expect(o.reviewer.seen).toEqual(["a.py"]);
    expect(result.files_reviewed).toBe(1);
  });

  it("reviews unpushed work", async () => {
    // The branch exists only locally and was never pushed.
    const root = repo();
    git(root, "checkout", "-q", "-b", "unpushed");
    writeFileSync(join(root, "a.py"), "one = 1\ntwo = 2\nfour = 4\n");
    git(root, "commit", "-qam", "more");
    const o = options(root, { branch: "unpushed" });
    await reviewBranch(o);
    expect(o.reviewer.seen).toContain("a.py");
  });

  it("makes no model call when nothing changed", async () => {
    const o = options(repo(), { branch: "main" });
    const result = await reviewBranch(o);
    expect(o.reviewer.seen).toEqual([]);
    expect(result.findings).toEqual([]);
  });

  it("surfaces an unrelated branch as a git error the operator can read", async () => {
    // With no merge-base the three-dot diff has nothing to fork from; git
    // refuses, and that refusal is reported rather than swallowed.
    const root = repo();
    git(root, "checkout", "-q", "--orphan", "island");
    writeFileSync(join(root, "island.py"), "alone = True\n");
    git(root, "add", "-A");
    git(root, "commit", "-qm", "unrelated history");
    await expect(reviewBranch(options(root, { branch: "island" }))).rejects.toThrow(
      /no merge base/u,
    );
  });
});

// -- skills ----------------------------------------------------------------

describe("skills", () => {
  it("names the skills used for each file on its findings", async () => {
    const result = await reviewBranch(
      options(repo(), { skills: new FakeSkills(["medusa-route"]) }),
    );
    expect(result.findings.every((f) => f.skills.join(",") === "medusa-route")).toBe(true);
  });

  it("carries no skills without a registry", async () => {
    const result = await reviewBranch(options(repo()));
    expect(result.findings.every((f) => f.skills.length === 0)).toBe(true);
  });

  it("carries the fix example", async () => {
    const result = await reviewBranch(options(repo(), { reviewer: new FakeReviewer("fix();") }));
    expect(result.findings.every((f) => f.example === "fix();")).toBe(true);
  });
});

// -- verification ----------------------------------------------------------

describe("verification", () => {
  /** Refutes every finding whose body the constructor names. */
  class FakeVerifier {
    readonly seen: string[] = [];

    constructor(private readonly refuse: string) {}

    verify(input: VerifyInput): Promise<Verdict> {
      this.seen.push(input.path);
      const kept = input.findings.filter((f) => f.body !== this.refuse);
      const refuted = input.findings
        .filter((f) => f.body === this.refuse)
        .map((finding_) => ({ finding: finding_, ground: "B", reason: "the diff shows it" }));
      return Promise.resolve({ kept, refuted });
    }
  }

  it("reports only what survived, and tallies what did not", async () => {
    const verifier = new FakeVerifier("boom");
    const result = await reviewBranch(options(repo(), { verifier }));
    // The fake reviewer says "boom" on every file, so nothing survives.
    expect(result.findings).toEqual([]);
    expect(result.refuted).toBe(2);
    expect(sortedByCodePoint(verifier.seen)).toEqual(["a.py", "new.py"]);
  });

  it("shows the verifier the same annotated diff the reviewer saw", async () => {
    let seen = "";
    const verifier = {
      verify: (input: VerifyInput): Promise<Verdict> => {
        if (input.path === "a.py") seen = input.annotatedPatch;
        return Promise.resolve({ kept: [...input.findings], refuted: [] });
      },
    };
    await reviewBranch(options(repo(), { verifier }));
    expect(seen).toContain("[L3] +three = 3");
  });

  it("reports every finding, and no tally, without a verifier", async () => {
    const result = await reviewBranch(options(repo()));
    expect(result.findings).toHaveLength(2);
    expect(result.refuted).toBe(0);
  });
});

// -- preview ---------------------------------------------------------------

describe("previewing a branch", () => {
  it("reports what would be reviewed and what would not, calling no model", async () => {
    const root = repo();
    const reviewer = new FakeReviewer();
    const { decisions, report } = await previewBranch({
      base: "main",
      branch: "feature",
      git: new LocalGitReader(root),
      settings: { ...DEFAULT_FILE_REVIEW_SETTINGS, exclude: ["new.py"] },
    });
    expect(reviewer.seen).toEqual([]);
    expect(decisions.map((decision) => [decision.path, decision.reason] as const)).toContainEqual([
      "a.py",
      "none",
    ]);
    expect(report).toContain("=== [PREVIEW] branch feature vs main ===");
    expect(report).toContain("review   a.py");
    expect(report).toContain("skipped  new.py");
    expect(report).toContain("excluded");
    expect(report).toContain("No model was called.");
  });

  it("decides exactly what the review then acts on", async () => {
    const root = repo();
    const settings = { ...DEFAULT_FILE_REVIEW_SETTINGS, exclude: ["new.py"] };
    const { decisions } = await previewBranch({
      base: "main",
      branch: "feature",
      git: new LocalGitReader(root),
      settings,
    });
    const promised = decisions.filter((d) => d.reason === "none").map((d) => d.path);
    const o = options(root, { settings });
    await reviewBranch(o);
    expect(sortedByCodePoint(o.reviewer.seen)).toEqual(sortedByCodePoint(promised));
  });
});

// -- streaming -------------------------------------------------------------

describe("streaming", () => {
  it("yields findings first and the summary last", async () => {
    const records: BranchReviewRecord[] = [];
    const stream = iterBranchReview(options(repo()));
    for await (const record of stream) records.push(record);
    expect(records.slice(0, -1).every((r) => r.type === "finding")).toBe(true);
    expect(records.at(-1)?.type).toBe("summary");
    expect(records.at(-1)).toMatchObject({ files_changed: 2, files_reviewed: 2, findings: 2 });
  });

  it("reports the anchor tallies in the summary", async () => {
    const result = await reviewBranch(options(repo()));
    expect(result.anchors).toEqual({ exact: 2 });
    expect(result.unanchored).toBe(0);
  });

  it("tallies anchors over the findings it reported, not the ones it withheld", async () => {
    // Two findings per file, one of them unanchored, and a cap of one. The
    // tallies have to describe the same population as `findings`, or a reader
    // cannot check one against the other: what the cap took is `capped`.
    const reviewer: PerFileReviewer = {
      reviewFile: (input) =>
        Promise.resolve([
          finding({
            line: Math.min(...input.allowedLines),
            severity: "bug",
            body: "kept",
            anchor: "exact",
          }),
          finding({ line: null, severity: "readability", body: "withheld", anchor: "failed" }),
        ]),
    };
    const result = await reviewBranch(options(repo(), { reviewer, maxFindingsPerFile: 1 }));
    expect(result.findings).toHaveLength(2);
    expect(result.anchors).toEqual({ exact: 2 });
    expect(result.unanchored).toBe(0);
    expect(result.capped).toBe(2);
  });

  it("counts a finding whose severity the model invented", async () => {
    const reviewer: PerFileReviewer = {
      reviewFile: (input) =>
        Promise.resolve([
          finding({
            line: Math.min(...input.allowedLines),
            severity: "readability",
            body: "x",
            severity_claimed: "catastrophic",
          }),
        ]),
    };
    const result = await reviewBranch(options(repo(), { reviewer }));
    // Reported under the mildest severity, and the substitution is a number
    // rather than a silent re-rating.
    expect(result.mislabelled).toBe(2);
    expect(result.findings.every((f) => f.severity === "readability")).toBe(true);
  });

  it("accounts for the files it did not review, by reason", async () => {
    const result = await reviewBranch(
      options(repo(), {
        settings: { ...DEFAULT_FILE_REVIEW_SETTINGS, exclude: ["new.py"] },
      }),
    );
    // The file the project excluded is accounted for rather than merely
    // missing from the reviewed count.
    expect(result.files_changed - result.files_reviewed).toBe(1);
    expect(result.skipped).toEqual({ excluded: 1 });
  });

  it("hands every record to the reporter as it is produced", async () => {
    const received: BranchReviewRecord[] = [];
    const reporter = {
      report(record: BranchReviewRecord): void {
        received.push(record);
      },
    };
    await streamBranchReview(options(repo()), reporter);
    expect(received.at(-1)?.type).toBe("summary");
    expect(received.slice(0, -1).every((r) => r.type === "finding" && "path" in r)).toBe(true);
  });

  it("survives a file whose review throws, reporting the rest", async () => {
    const reviewer: PerFileReviewer = {
      reviewFile: (input) =>
        input.path === "a.py"
          ? Promise.reject(new Error("model exploded"))
          : Promise.resolve([finding({ line: 1, severity: "bug", body: "ok" })]),
    };
    const result = await reviewBranch(options(repo(), { reviewer }));
    expect(result.files_reviewed).toBe(1);
    expect(result.findings.map((f) => f.path)).toEqual(["new.py"]);
  });

  it("counts the file whose review threw, so the run's arithmetic adds up", async () => {
    // Without this the file leaves the run as nothing but a smaller
    // `files_reviewed`: not skipped, not reviewed, and not mentioned.
    const reviewer: PerFileReviewer = {
      reviewFile: (input) =>
        input.path === "a.py"
          ? Promise.reject(new Error("model exploded"))
          : Promise.resolve([finding({ line: 1, severity: "bug", body: "ok" })]),
    };
    const result = await reviewBranch(options(repo(), { reviewer }));
    expect(result.failed).toBe(1);
    const accounted =
      result.files_reviewed +
      result.failed +
      Object.values(result.skipped).reduce((sum, n) => sum + n, 0);
    expect(accounted).toBe(result.files_changed);
  });

  it("says nothing was found without claiming the run was clean", () => {
    const lines = branchReviewText("main", "feature", { findings: [], failed: 2, truncated: 1 });
    expect(lines).toContain("No issues found.");
    expect(lines).toContain("2 file(s) could not be reviewed; the log says why.");
    expect(lines.some((line) => line.includes("too large to show in full"))).toBe(true);
  });
});

// -- text output -----------------------------------------------------------

describe("text output", () => {
  interface TextInput {
    base: string;
    branch: string;
    result: { findings: never[]; anchors?: Record<string, number> };
  }

  it.each(loadFixture<TextInput, string>("branch_text"))("$name", ({ input, expected }) => {
    const lines = branchReviewText(input.base, input.branch, input.result);
    expect(`${lines.join("\n")}\n`).toBe(expected);
  });
});
