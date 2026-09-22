/**
 * The CI surface: a finding becomes an annotation on the changed line, a row
 * in the job summary, and — through `--out` — a record a bot can post from.
 *
 * What is pinned here is the contract the workflow depends on. The reviewer
 * posts nothing, so if these three renderings are wrong, a finding reaches
 * nobody.
 */

import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";

import { buildContainer } from "../../../../src/cli/container";
import { type Finding, finding } from "../../../../src/core/domain/finding";
import {
  type FindingRecord,
  type LineWriter,
  type SummaryRecord,
} from "../../../../src/core/ports/review-reporter";
import { capPerFile } from "../../../../src/core/review/volume";
import { resolveLogSettings } from "../../../../src/providers/logging/log-settings";
import {
  GithubReporter,
  annotationFor,
  summaryFor,
} from "../../../../src/providers/reporting/github/reporter";

function record(over: Partial<Omit<FindingRecord, "type">> = {}): Omit<FindingRecord, "type"> {
  return {
    path: "src/a.ts",
    line: 12,
    start_line: null,
    anchor: "exact",
    severity: "bug",
    body: "Null check missing.",
    example: "",
    skills: [],
    ...over,
  };
}

const SUMMARY: SummaryRecord = {
  type: "summary",
  base: "main",
  branch: "HEAD",
  files_changed: 4,
  files_reviewed: 2,
  failed: 0,
  findings: 1,
  files_with_findings: 1,
  anchors: { exact: 1 },
  unanchored: 0,
  refuted: 0,
  capped: 0,
  mislabelled: 0,
  skipped: { excluded: 2 },
  policy_changed: [],
};

/** One finding of a given severity, anchored at `line` (`null` = unanchored). */
function at(severity: string, line: number | null): Finding {
  return finding({ line, severity, body: `${severity} at ${String(line)}` });
}

/**
 * Collects what a reporter writes.
 *
 * A plain function, not a fake stream: a reporter takes a `LineWriter`, so a
 * test needs no cast and no `node:stream` at all.
 */
function sink(): { write: LineWriter; lines: string[] } {
  const lines: string[] = [];
  return {
    write: (text) => {
      lines.push(text);
    },
    lines,
  };
}

describe("annotations", () => {
  it("puts a bug on its line as an error and a readability note as a warning", () => {
    expect(annotationFor(record())).toBe(
      "::error file=src/a.ts,line=12,title=Bug/correctness (code-reviewer)::Null check missing.",
    );
    expect(annotationFor(record({ severity: "readability" }))).toMatch(/^::warning /u);
    expect(annotationFor(record({ severity: "security" }))).toMatch(/^::error /u);
    expect(annotationFor(record({ severity: "performance" }))).toMatch(/^::warning /u);
  });

  it("spans a multi-line anchor with line..endLine", () => {
    expect(annotationFor(record({ start_line: 9 }))).toContain("line=9,endLine=12");
  });

  it("declines a finding with no line, because GitHub has nowhere to put it", () => {
    // It is not lost: `summaryFor` still lists it. See the summary test below.
    expect(annotationFor(record({ line: null }))).toBeNull();
  });

  it("escapes what the workflow-command format would otherwise eat", () => {
    // An unescaped newline truncates the message to its first line, which is
    // how a finding silently loses its explanation.
    const annotation = annotationFor(record({ body: "a\nb", example: "x,y" }));
    expect(annotation).toContain("%0A");
    expect(annotation).not.toMatch(/::.*\n/u);
    expect(annotationFor(record({ path: "src/a,b.ts" }))).toContain("file=src/a%2Cb.ts");
  });
});

describe("the job summary", () => {
  it("lists an unanchored finding rather than dropping it", () => {
    const markdown = summaryFor([record({ line: null })], { ...SUMMARY, unanchored: 1 });
    expect(markdown).toContain("src/a.ts (no line)");
    expect(markdown).toContain("1 without a line anchor");
  });

  it("sorts by severity, most severe first", () => {
    const markdown = summaryFor(
      [record({ severity: "readability", body: "Nit." }), record({ severity: "bug" })],
      null,
    );
    expect(markdown.indexOf("Bug/correctness")).toBeLessThan(markdown.indexOf("Readability"));
  });

  it("says so plainly when nothing was found", () => {
    expect(summaryFor([], SUMMARY)).toContain("No issues found");
  });

  it("reports what verification and the cap removed", () => {
    const markdown = summaryFor([record()], { ...SUMMARY, refuted: 2, capped: 3 });
    expect(markdown).toContain("2 finding(s) refuted by verification");
    expect(markdown).toContain("3 withheld by max-findings-per-file");
  });

  it("keeps a pipe in a body from breaking the table", () => {
    expect(summaryFor([record({ body: "a | b" })], null)).toContain("a \\| b");
  });

  it("calls out a change that edits the review policy before anything else", () => {
    const markdown = summaryFor([record()], {
      ...SUMMARY,
      policy_changed: [".review/config.yaml"],
    });
    const [heading, , warning] = markdown.split("\n", 3);
    expect(heading).toBe("## Code review");
    expect(warning).toContain("edits the review policy (.review/config.yaml)");
    expect(summaryFor([record()], SUMMARY)).not.toContain("review policy");
  });
});

describe("the reporter", () => {
  it("streams annotations as they arrive and writes the summary at the end", () => {
    const { write, lines } = sink();
    const written: string[] = [];
    const reporter = new GithubReporter(write, (markdown) => {
      written.push(markdown);
    });

    reporter.report({ type: "finding", ...record() });
    // The annotation is out before the run is over: a long review shows its
    // first finding immediately.
    expect(lines).toHaveLength(1);
    expect(written).toHaveLength(0);

    reporter.report(SUMMARY);
    expect(written).toHaveLength(1);
    expect(written[0]).toContain("`src/a.ts:12`");
  });

  it("writes no summary when there is nowhere to write one", () => {
    const { write } = sink();
    const reporter = new GithubReporter(write, null);
    expect(() => {
      reporter.report(SUMMARY);
    }).not.toThrow();
  });
});

describe("the per-file cap", () => {
  it("keeps everything when the cap is off or not reached", () => {
    const findings = [at("bug", 1), at("readability", 2)];
    expect(capPerFile(findings, 0)).toEqual({ kept: findings, capped: 0 });
    expect(capPerFile(findings, 5)).toEqual({ kept: findings, capped: 0 });
  });

  it("keeps the most severe and counts the rest", () => {
    const result = capPerFile(
      [at("readability", 1), at("bug", 2), at("performance", 3), at("security", 4)],
      2,
    );
    expect(result.kept.map((f) => f.severity)).toEqual(["bug", "security"]);
    // The point of the tally: three findings existed, one was withheld, and
    // the run can say so.
    expect(result.capped).toBe(2);
  });

  it("breaks a tie by line, so two runs cut the same findings", () => {
    const result = capPerFile([at("bug", 9), at("bug", 2)], 1);
    expect(result.kept.map((f) => f.line)).toEqual([2]);
  });

  it("sorts an unanchored finding last within its severity", () => {
    const result = capPerFile([at("bug", null), at("bug", 7)], 1);
    expect(result.kept[0]?.line).toBe(7);
  });
});

describe("--out, whatever the format", () => {
  it("tees the records to a file even when the format is text", async () => {
    // The bug this pins: `text` renders the whole run at the end, so an
    // earlier version never touched the reporter and `--out` silently wrote
    // nothing — which is exactly the file a CI bot reads.
    const directory = mkdtempSync(join(tmpdir(), "reviewer-out-"));
    const path = join(directory, "findings.ndjson");
    const { cradle } = buildContainer({
      configFile: null,
      logging: resolveLogSettings(),
      overrides: {},
      requiresModel: false,
      format: "text",
      outFile: path,
    });
    cradle.branchReporter.report({ type: "finding", ...record() });
    cradle.branchReporter.report(SUMMARY);
    await setTimeout(50);

    const lines = readFileSync(path, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0] ?? "")).toMatchObject({ type: "finding", path: "src/a.ts" });
    expect(JSON.parse(lines[1] ?? "")).toMatchObject({ type: "summary" });
  });
});
