/**
 * The scope decision and the report `--preview` prints from it.
 *
 * These two are tested together on purpose: the whole reason the decision is
 * one pure function is that the preview and the run consume the same value,
 * so a test that let them drift apart would be testing the wrong thing.
 */

import { describe, expect, it } from "bun:test";

import { DEFAULT_FILE_REVIEW_SETTINGS } from "../../../src/core/config/settings";
import { previewReport } from "../../../src/core/review/render";
import {
  MAX_DIFF_CHARS,
  type SelectionReason,
  decideFile,
  isSelected,
  logSkips,
  selectFiles,
  selectedFiles,
  skipCounts,
  skipDetail,
  skippedFiles,
} from "../../../src/core/review/selection";
import { recordingLogger } from "../../helpers/logging";

const PATCH = "@@ -1 +1,2 @@\n old\n+added line\n";
const BINARY = "diff --git a/x.png b/x.png\nBinary files a/x.png and b/x.png differ\n";
/** Two hunks, each adding a line. */
const TWO_HUNKS =
  "@@ -1,2 +1,3 @@\n alpha\n+beta\n gamma\n@@ -20,2 +21,3 @@\n delta\n+epsilon\n zeta\n";

/** One hunk adding lines of `x` until the annotated diff is exactly `chars` code points long. */
function patchOfSize(chars: number): string {
  const header = "@@ -1,0 +1,1 @@";
  const line = "[L1] +";
  const filler = chars - header.length - 1 - line.length;
  if (filler < 0) throw new Error(`no patch is ${chars} chars long`);
  return `${header}\n+${"x".repeat(filler)}\n`;
}

function reasonFor(
  filename: string,
  status = "modified",
  patch: string = PATCH,
  exclude: readonly string[] = [],
): SelectionReason {
  return decideFile({ filename, status, patch }, { ...DEFAULT_FILE_REVIEW_SETTINGS, exclude })
    .reason;
}

describe("deciding which files are reviewed", () => {
  it("reviews an ordinary changed file", () => {
    const decision = decideFile(
      { filename: "src/a.ts", status: "modified", patch: PATCH },
      DEFAULT_FILE_REVIEW_SETTINGS,
    );
    expect(decision.reason).toBe("none");
    expect(isSelected(decision)).toBe(true);
    expect(decision.file?.path).toBe("src/a.ts");
    expect([...decision.addedLines]).toEqual([2]);
    expect(decision.annotatedPatch).toBe("@@ -1,1 +1,2 @@\n old\n[L2] +added line");
    expect(decision.diffChars).toBe(decision.annotatedPatch.length);
  });

  it("names a reason for every file it does not review", () => {
    // A provider that reports no patch at all (it omits one for a file it
    // considers too large), and a record with no path.
    expect(
      decideFile({ filename: "a.ts", status: "modified" }, DEFAULT_FILE_REVIEW_SETTINGS).reason,
    ).toBe("no_patch");
    expect(reasonFor("", "modified")).toBe("no_patch");
    expect(reasonFor("x.png", "modified", BINARY)).toBe("binary");
    expect(reasonFor("a.ts", "removed")).toBe("status");
    // A rename with hunks was edited as it moved: reviewed, not skipped.
    expect(reasonFor("a.ts", "renamed")).toBe("none");
    expect(reasonFor("a.spec.ts", "modified", PATCH, ["**/*.spec.ts"])).toBe("excluded");
    expect(reasonFor("a.ts", "modified", "@@ -1,2 +1 @@\n a\n-b\n")).toBe("no_added_lines");
  });

  it.each([".env", ".env.example", "keys/id_rsa", "a/.npmrc", "certs/x.pem", "ID_RSA"])(
    "refuses %s as a credential file, whatever the configuration says",
    (path) => {
      expect(reasonFor(path, "added")).toBe("secret");
    },
  );

  it("settles the guarantees that are not the project's to make first", () => {
    // A credential file the project also excluded is still reported as the
    // credential it is: the reason an operator must be able to trust is the
    // one that is not configurable.
    expect(reasonFor(".env", "modified", PATCH, ["**/.env"])).toBe("secret");
    // And a deleted credential file is refused before its status matters.
    expect(reasonFor(".env", "removed", PATCH)).toBe("secret");
  });

  it("shows the whole diff, and allows exactly the lines it contains", () => {
    // Every line a finding may anchor to is a line the model was shown, and
    // the quote matcher's haystack is that same text: the three come from one
    // value, and nothing is cut out of it.
    const decision = decideFile(
      { filename: "a.ts", status: "modified", patch: TWO_HUNKS },
      DEFAULT_FILE_REVIEW_SETTINGS,
    );
    if (!isSelected(decision)) throw new Error(`expected a.ts to be selected`);
    expect(decision.annotatedPatch).toBe(
      "@@ -1,2 +1,3 @@\n alpha\n[L2] +beta\n gamma\n@@ -20,2 +21,3 @@\n delta\n[L22] +epsilon\n zeta",
    );
    expect(decision.diffChars).toBe(86);
    const shown = decision.annotatedPatch
      .split("\n")
      .map((line) => /^\[L(\d+)\]/u.exec(line)?.[1])
      .filter((line): line is string => line !== undefined)
      .map(Number);
    expect([...decision.addedLines].toSorted((a, b) => a - b)).toEqual(shown);
    expect(decision.newSide.map(([line]) => line)).toEqual([1, 2, 3, 21, 22, 23]);
  });

  it("skips a diff over the ceiling as too large instead of cutting it, and says what to do", () => {
    // Whole or not at all: a diff one character over the ceiling is not sent
    // in part, it is not sent. The detail names the size and the fix.
    const over = decideFile(
      { filename: "dist/bundle.js", status: "modified", patch: patchOfSize(MAX_DIFF_CHARS + 1) },
      DEFAULT_FILE_REVIEW_SETTINGS,
    );
    expect(over.reason).toBe("too_large");
    expect(over.file).toBeNull();
    expect(over.annotatedPatch).toBe("");
    expect(over.diffChars).toBe(MAX_DIFF_CHARS + 1);
    if (isSelected(over)) throw new Error("expected dist/bundle.js to be skipped");
    expect(skipDetail(over)).toBe("too large (200,001 chars; exclude it or split the change)");

    const under = decideFile(
      { filename: "dist/bundle.js", status: "modified", patch: patchOfSize(MAX_DIFF_CHARS) },
      DEFAULT_FILE_REVIEW_SETTINGS,
    );
    expect(under.reason).toBe("none");
    expect(under.diffChars).toBe(MAX_DIFF_CHARS);
    expect(under.annotatedPatch.length).toBe(MAX_DIFF_CHARS);
  });

  it("asks whether a diff is too large last", () => {
    // A credential that is also huge must still read `secret`, and an
    // excluded one `excluded`: the reasons an operator acts on come first.
    const huge = patchOfSize(MAX_DIFF_CHARS + 1);
    expect(reasonFor(".env", "modified", huge)).toBe("secret");
    expect(reasonFor("dist/bundle.js", "modified", huge, ["dist/**"])).toBe("excluded");
    expect(reasonFor("gone.js", "removed", huge)).toBe("status");
  });

  it("keeps the reported order and counts the skips by reason", () => {
    const decisions = selectFiles(
      [
        { filename: "src/a.ts", status: "modified", patch: PATCH },
        { filename: ".env", status: "modified", patch: PATCH },
        { filename: "src/b.spec.ts", status: "modified", patch: PATCH },
        { filename: "src/c.spec.ts", status: "modified", patch: PATCH },
        { filename: "gone.ts", status: "removed", patch: PATCH },
      ],
      { ...DEFAULT_FILE_REVIEW_SETTINGS, exclude: ["**/*.spec.ts"] },
    );
    expect(decisions.map((d) => d.path)).toEqual([
      "src/a.ts",
      ".env",
      "src/b.spec.ts",
      "src/c.spec.ts",
      "gone.ts",
    ]);
    expect(selectedFiles(decisions).map((d) => d.path)).toEqual(["src/a.ts"]);
    expect(skippedFiles(decisions).map((d) => d.path)).toEqual([
      ".env",
      "src/b.spec.ts",
      "src/c.spec.ts",
      "gone.ts",
    ]);
    expect(Object.fromEntries(skipCounts(decisions))).toEqual({
      secret: 1,
      excluded: 2,
      status: 1,
    });
  });

  it("names the status it skipped on", () => {
    const decisions = selectFiles(
      [{ filename: "gone.ts", status: "removed", patch: PATCH }],
      DEFAULT_FILE_REVIEW_SETTINGS,
    );
    expect(skipDetail(skippedFiles(decisions)[0]!)).toBe("status=removed");
  });

  it("says which credential file it withheld without verbose logging, and nothing else", () => {
    const lines: string[] = [];
    logSkips(
      selectFiles(
        [
          { filename: "src/a.ts", status: "modified", patch: PATCH },
          { filename: ".env", status: "modified", patch: PATCH },
          { filename: "gone.ts", status: "removed", patch: PATCH },
        ],
        DEFAULT_FILE_REVIEW_SETTINGS,
      ),
      recordingLogger(lines),
    );
    expect(lines).toEqual([
      "INFO skip .env: names a credential file; its contents are never sent.",
      "DEBUG skip gone.ts (status=removed).",
    ]);
  });

  it("says which file was too large without verbose logging", () => {
    // The operator has to act on it (exclude, or split the change), so it is
    // not buried at DEBUG like a skip the run's arithmetic explains.
    const lines: string[] = [];
    logSkips(
      selectFiles(
        [
          {
            filename: "dist/bundle.js",
            status: "modified",
            patch: patchOfSize(MAX_DIFF_CHARS + 1),
          },
        ],
        DEFAULT_FILE_REVIEW_SETTINGS,
      ),
      recordingLogger(lines),
    );
    expect(lines).toEqual([
      "INFO skip dist/bundle.js (too large (200,001 chars; exclude it or split the change)).",
    ]);
  });
});

describe("the preview report", () => {
  const decisions = selectFiles(
    [
      { filename: "src/b.ts", status: "modified", patch: PATCH },
      { filename: "src/a.ts", status: "added", patch: PATCH },
      { filename: "package-lock.json", status: "modified", patch: PATCH },
      { filename: ".env", status: "modified", patch: PATCH },
    ],
    { ...DEFAULT_FILE_REVIEW_SETTINGS, exclude: ["package-lock.json"] },
  );

  it("lists the files to review first, then the skipped ones with their reason", () => {
    const report = previewReport("PR #7 @ aa61df6", decisions);
    expect(report.split("\n")).toEqual([
      "",
      "=== [PREVIEW] PR #7 @ aa61df6 ===",
      "4 changed file(s); 2 to review, 2 skipped.",
      "",
      "  review   src/a.ts           +1",
      "  review   src/b.ts           +1",
      "  skipped  .env               credential file",
      "  skipped  package-lock.json  excluded",
      "",
      "skipped: excluded=1, secret=1",
      "No model was called.",
    ]);
  });

  it("names a file too large to review, with its size and the fix", () => {
    const large = selectFiles(
      [
        { filename: "src/a.ts", status: "modified", patch: PATCH },
        { filename: "dist/bundle.js", status: "modified", patch: patchOfSize(MAX_DIFF_CHARS + 1) },
      ],
      DEFAULT_FILE_REVIEW_SETTINGS,
    );
    expect(previewReport("HEAD vs main", large).split("\n")).toEqual([
      "",
      "=== [PREVIEW] HEAD vs main ===",
      "2 changed file(s); 1 to review, 1 skipped.",
      "",
      "  review   src/a.ts        +1",
      "  skipped  dist/bundle.js  too large (200,001 chars; exclude it or split the change)",
      "",
      "skipped: too_large=1",
      "No model was called.",
    ]);
  });

  it("reports an empty change set without pretending a review happened", () => {
    expect(previewReport("PR #9 @ abc1234", []).split("\n")).toEqual([
      "",
      "=== [PREVIEW] PR #9 @ abc1234 ===",
      "0 changed file(s); 0 to review, 0 skipped.",
      "No model was called.",
    ]);
  });
});
