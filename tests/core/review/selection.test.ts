/**
 * The scope decision and the report `--preview` prints from it.
 *
 * These two are tested together on purpose: the whole reason the decision is
 * one pure function is that the preview and the run consume the same value,
 * so a test that let them drift apart would be testing the wrong thing.
 */

import { describe, expect, it } from "vitest";

import { DEFAULT_FILE_REVIEW_SETTINGS } from "../../../src/core/config/settings";
import { previewReport } from "../../../src/core/review/render";
import {
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
    expect(decision.truncated).toBe(false);
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
    expect(reasonFor("a.ts", "renamed")).toBe("status");
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

  it("cuts an oversized diff instead of skipping the file", () => {
    const decision = decideFile(
      { filename: "a.ts", status: "modified", patch: PATCH },
      { ...DEFAULT_FILE_REVIEW_SETTINGS, maxFileChars: 10 },
    );
    expect(decision.reason).toBe("none");
    expect(decision.annotatedPatch).toBe("@@ -1,1 +1");
    expect(decision.truncated).toBe(true);
    expect(decision.diffChars).toBe(37);
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
    const report = previewReport("PR #7 @ aa61df6", decisions, 8000);
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

  it("says that a cut diff was cut, and by how much", () => {
    const cut = selectFiles([{ filename: "a.ts", status: "modified", patch: PATCH }], {
      ...DEFAULT_FILE_REVIEW_SETTINGS,
      maxFileChars: 10,
    });
    expect(previewReport("branch x vs main", cut, 10)).toContain("+1 (diff cut at 10 of 37 chars)");
  });

  it("reports an empty change set without pretending a review happened", () => {
    expect(previewReport("PR #9 @ abc1234", [], 8000).split("\n")).toEqual([
      "",
      "=== [PREVIEW] PR #9 @ abc1234 ===",
      "0 changed file(s); 0 to review, 0 skipped.",
      "No model was called.",
    ]);
  });
});
