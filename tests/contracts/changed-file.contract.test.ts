import { describe, expect, it } from "bun:test";

import pLimit from "p-limit";

import { ChangedFile } from "../../src/core/domain/changed-file";
import { type Finding, finding } from "../../src/core/domain/finding";
import { type ReviewFileInput } from "../../src/core/review/file-reviewer";
import {
  DEFAULT_FILE_REVIEW_SETTINGS,
  type PerFileReviewer,
  countAnchors,
  reviewChangedFile,
} from "../../src/core/review/review-file";
import { type SelectedFile, decideFile, isSelected } from "../../src/core/review/selection";
import { recordingLogger } from "../helpers/logging";

import { caseNamed, loadFixture } from "./fixtures";

const helpers = loadFixture("changed_file_helpers");

const PATCH = "@@ -1 +1,2 @@\n old\n+added line\n";
/** Two hunks, each adding a line: what a cap has to choose between. */
const TWO_HUNKS =
  "@@ -1,2 +1,3 @@\n alpha\n+beta\n gamma\n@@ -20,2 +21,3 @@\n delta\n+epsilon\n zeta\n";

/** Reports one finding per file, on that file's first added line; records inputs. */
class FakeReviewer implements PerFileReviewer {
  readonly seen: ReviewFileInput[] = [];

  reviewFile(input: ReviewFileInput): Promise<Finding[]> {
    this.seen.push(input);
    const first = input.allowedLines.size > 0 ? Math.min(...input.allowedLines) : 0;
    return Promise.resolve([finding({ line: first, severity: "bug", body: "boom" })]);
  }
}

/** The decision for a file that must be reviewable, as the flows hand it over. */
function selected(file: ChangedFile, settings = DEFAULT_FILE_REVIEW_SETTINGS): SelectedFile {
  const decision = decideFile(file, settings);
  if (!isSelected(decision)) {
    throw new Error(`expected ${file.path} to be selected, got '${decision.reason}'`);
  }
  return decision;
}

async function review(
  file: ChangedFile,
  options: Partial<Parameters<typeof reviewChangedFile>[1]> = {},
): Promise<{ result: Awaited<ReturnType<typeof reviewChangedFile>>; reviewer: FakeReviewer }> {
  const reviewer = new FakeReviewer();
  const settings = options.settings ?? DEFAULT_FILE_REVIEW_SETTINGS;
  const result = await reviewChangedFile(selected(file, settings), {
    reviewer,
    settings,
    skills: null,
    limit: pLimit(2),
    ...options,
  });
  return { result, reviewer };
}

describe("anchor tallies", () => {
  it("counts every outcome, an empty one as exact", () => {
    const findings: Finding[] = [
      finding({ line: 2, severity: "bug", body: "one", example: "fix();", anchor: "exact" }),
      finding({ line: null, severity: "security", body: "two", anchor: "failed" }),
      finding({
        line: 9,
        severity: "performance",
        body: "three",
        start_line: 7,
        anchor: "repaired",
      }),
      finding({ line: 1, severity: "weird", body: "w", anchor: "conflict" }),
    ];
    expect(Object.fromEntries(countAnchors(findings))).toEqual(
      caseNamed<unknown, Record<string, number>>(helpers, "count_anchors").expected,
    );
    const blank = {
      ...finding({ line: 1, severity: "bug", body: "x" }),
      anchor: "" as Finding["anchor"],
    };
    expect(Object.fromEntries(countAnchors([blank]))).toEqual(
      caseNamed<unknown, Record<string, number>>(
        helpers,
        "count_anchors/empty_anchor_counts_as_exact",
      ).expected,
    );
  });

  it("never reviews removed or renamed files", () => {
    expect(helpers.find((c) => c.name === "skip_statuses")?.expected).toEqual([
      "removed",
      "renamed",
    ]);
  });
});

describe("building a changed file from a diff record", () => {
  it("needs a filename and a patch", () => {
    expect(ChangedFile.fromEntry({ filename: "a.ts", status: "modified", patch: PATCH })).toEqual(
      new ChangedFile("a.ts", "modified", PATCH),
    );
    expect(ChangedFile.fromEntry({ filename: "a.ts", status: "modified" })).toBeNull();
    expect(ChangedFile.fromEntry({ filename: "", patch: PATCH })).toBeNull();
    expect(ChangedFile.fromEntry({ filename: "a.ts", patch: PATCH })?.status).toBe("");
  });
});

describe("the shared per-file step", () => {
  // Which files are reviewed at all is `selection.ts`'s decision (see
  // tests/selection.test.ts). What is pinned here is the one refusal this
  // step keeps for itself, because a leaked credential cannot be recalled.
  it("refuses a credential file even when handed one as a decision to review", async () => {
    const lines: string[] = [];
    const reviewer = new FakeReviewer();
    const smuggled: SelectedFile = {
      ...selected(new ChangedFile("a.ts", "modified", PATCH)),
      path: ".env",
      file: new ChangedFile(".env", "modified", PATCH),
    };
    const result = await reviewChangedFile(smuggled, {
      reviewer,
      settings: DEFAULT_FILE_REVIEW_SETTINGS,
      skills: null,
      limit: pLimit(2),
      logger: recordingLogger(lines),
    });
    expect(result).toBeNull();
    expect(reviewer.seen).toHaveLength(0);
    expect(lines).toEqual([
      "INFO skip .env: names a credential file; its contents are never sent.",
    ]);
  });

  it("reads context for a modified file but not for an added one", async () => {
    const reads: string[] = [];
    const readContent = (path: string): Promise<string | null> => {
      reads.push(path);
      return Promise.resolve("full text");
    };
    const modified = await review(new ChangedFile("a.ts", "modified", PATCH), { readContent });
    expect(modified.reviewer.seen[0]?.content).toBe("full text");
    const added = await review(new ChangedFile("new.ts", "added", PATCH), { readContent });
    expect(added.reviewer.seen[0]?.content).toBeNull();
    expect(reads).toEqual(["a.ts"]);
  });

  it("hands the reviewer the annotated diff, the allowed lines and the anchor index", async () => {
    const { result, reviewer } = await review(new ChangedFile("a.ts", "modified", PATCH));
    const input = reviewer.seen[0];
    expect(input?.annotatedPatch).toBe("@@ -1,1 +1,2 @@\n old\n[L2] +added line");
    expect([...(input?.allowedLines ?? [])]).toEqual([2]);
    expect(input?.anchorIndex).toEqual([
      [1, "old"],
      [2, "added line"],
    ]);
    expect(result?.findings.map((f) => f.line)).toEqual([2]);
    expect(result?.skillNames).toEqual([]);
  });

  it("names the skills that were in the prompt", async () => {
    const skills = {
      skillsFor: () => [
        { name: "medusa-route", globs: ["**"], body: "b", source: "repo", description: "" },
      ],
      renderFor: () => "skills-text",
    };
    const { result, reviewer } = await review(new ChangedFile("a.ts", "modified", PATCH), {
      skills,
    });
    expect(result?.skillNames).toEqual(["medusa-route"]);
    expect(reviewer.seen[0]?.skillsText).toBe("skills-text");
  });

  it("cuts an oversized diff at a hunk boundary, and allows only what it shows", async () => {
    const firstHunk = "@@ -1,2 +1,3 @@\n alpha\n[L2] +beta\n gamma";
    const { reviewer } = await review(new ChangedFile("a.ts", "modified", TWO_HUNKS), {
      // Room for the first hunk and not a character more.
      settings: { ...DEFAULT_FILE_REVIEW_SETTINGS, maxFileChars: firstHunk.length },
    });
    const input = reviewer.seen[0];
    // A whole hunk, not a mid-line cut: the text stays a diff whose `[L<n>]`
    // markers mean what they say.
    expect(input?.annotatedPatch).toBe(firstHunk);
    // And the two derived answers describe that text and nothing else -- the
    // model is never told it may comment on a line it was not shown, and the
    // quote matcher never searches text nobody sent.
    expect([...(input?.allowedLines ?? [])]).toEqual([2]);
    expect(input?.anchorIndex?.map(([line]) => line)).toEqual([1, 2, 3]);
  });

  it("shows one commentable line however small the cap", async () => {
    // The cap cannot leave a file with a prompt it could not answer: a diff
    // with nothing commentable in it would ask the model to invent a line.
    const { reviewer } = await review(new ChangedFile("a.ts", "modified", TWO_HUNKS), {
      settings: { ...DEFAULT_FILE_REVIEW_SETTINGS, maxFileChars: 1 },
    });
    const input = reviewer.seen[0];
    expect([...(input?.allowedLines ?? [])]).toEqual([2]);
    expect(input?.annotatedPatch).toContain("[L2] +beta");
  });
});
