import { describe, expect, it } from "bun:test";

import pLimit from "p-limit";

import { ChangedFile } from "../../src/core/domain/changed-file";
import { type Finding, finding } from "../../src/core/domain/finding";
import { type ReviewFileInput } from "../../src/core/review/file-reviewer";
import {
  DEFAULT_FILE_REVIEW_SETTINGS,
  MAX_CONTENT_CHARS,
  type PerFileReviewer,
  countAnchors,
  reviewChangedFile,
} from "../../src/core/review/review-file";
import { type SelectedFile, decideFile, isSelected } from "../../src/core/review/selection";
import { recordingLogger } from "../helpers/logging";

import { caseNamed, loadFixture } from "./fixtures";

const helpers = loadFixture("changed_file_helpers");

const PATCH = "@@ -1 +1,2 @@\n old\n+added line\n";

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

  it("says how long each waiting step took, so a slow run can be read back", async () => {
    // A pinned clock: each read moves it forward by a known step, so the line
    // says what the arithmetic says and not what the machine was doing.
    const ticks = [0, 200, 200, 42_500, 42_500, 60_600];
    let read = 0;
    const now = (): number => ticks[Math.min(read++, ticks.length - 1)] ?? 0;
    const lines: string[] = [];
    const verifier = {
      verify: (input: { findings: readonly Finding[] }) =>
        Promise.resolve({ kept: [...input.findings], refuted: [] }),
    };
    await review(new ChangedFile("a.ts", "modified", PATCH), {
      logger: recordingLogger(lines),
      verifier,
      now,
    });
    expect(lines).toEqual([
      "INFO review a.ts: +1 line(s), skills=[], 1 finding(s) (context 0.2s, model 42.3s, verify 18.1s).",
    ]);
  });

  it("reports no verify timing when there is no verifier", async () => {
    const lines: string[] = [];
    let now = 0;
    await review(new ChangedFile("a.ts", "modified", PATCH), {
      logger: recordingLogger(lines),
      now: () => (now += 500),
    });
    expect(lines).toEqual([
      "INFO review a.ts: +1 line(s), skills=[], 1 finding(s) (context 0.5s, model 0.5s).",
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

  it("attaches a file's text whole or not at all, and says when it withheld it", async () => {
    // A prefix of the file would hide the code around the change and look
    // like the file; past the ceiling the diff alone is reviewed, and the log
    // says so once.
    const lines: string[] = [];
    const atCeiling = "x".repeat(MAX_CONTENT_CHARS);
    const fits = await review(new ChangedFile("a.ts", "modified", PATCH), {
      readContent: () => Promise.resolve(atCeiling),
      logger: recordingLogger(lines),
    });
    expect(fits.reviewer.seen[0]?.content).toBe(atCeiling);
    expect(lines.filter((line) => line.startsWith("INFO content"))).toEqual([]);

    const over = await review(new ChangedFile("src/x.ts", "modified", PATCH), {
      readContent: () => Promise.resolve(`${atCeiling}x`),
      logger: recordingLogger(lines),
    });
    expect(over.reviewer.seen[0]?.content).toBeNull();
    expect(lines.filter((line) => line.startsWith("INFO content"))).toEqual([
      "INFO content src/x.ts: 200,001 chars exceeds the 200,000 ceiling; the diff alone was reviewed.",
    ]);
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

  it("tells the reviewer the run's per-file cap, and asks for no limit without one", async () => {
    // The cap is applied after the call (`volume.ts`); telling the model
    // first is what keeps a file with a dozen problems from paying for a
    // dozen findings' worth of generation and reporting three.
    const capped = await review(new ChangedFile("a.ts", "modified", PATCH), {
      maxFindingsPerFile: 3,
    });
    expect(capped.reviewer.seen[0]?.maxFindings).toBe(3);
    const uncapped = await review(new ChangedFile("a.ts", "modified", PATCH));
    expect(uncapped.reviewer.seen[0]?.maxFindings).toBe(0);
  });

  it("names the skills that were in the prompt", async () => {
    const skills = {
      renderFor: () => ({ text: "skills-text", applied: ["http-route"] }),
    };
    const { result, reviewer } = await review(new ChangedFile("a.ts", "modified", PATCH), {
      skills,
    });
    expect(result?.skillNames).toEqual(["http-route"]);
    expect(reviewer.seen[0]?.skillsText).toBe("skills-text");
  });
});
