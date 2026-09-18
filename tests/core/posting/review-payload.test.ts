/**
 * NDJSON in, one review out.
 *
 * The shape of a review is decided here, with no token, no network and no
 * model -- which is what makes the posting half reviewable at all. What a
 * hosting system then does with it is `providers/repository/github`'s test.
 */

import { describe, expect, it } from "bun:test";

import { type SummaryRecord } from "../../../src/core/ports/review-reporter";
import {
  type Finding,
  buildReview,
  commentBody,
  parseRecords,
  reviewEventFor,
} from "../../../src/core/posting/review-payload";

function finding(over: Partial<Finding> = {}): Finding {
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
  truncated: 0,
  findings: 1,
  files_with_findings: 1,
  anchors: { exact: 1 },
  unanchored: 0,
  refuted: 0,
  capped: 0,
  mislabelled: 0,
  skipped: {},
};

/** The record stream as the reviewer writes it. */
function ndjson(...records: unknown[]): string {
  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

describe("reading a record stream", () => {
  it("splits findings from the summary", () => {
    const records = parseRecords(ndjson({ type: "finding", ...finding() }, SUMMARY));
    expect(records.findings).toHaveLength(1);
    expect(records.summary?.base).toBe("main");
    expect(records.unreadable).toBe(0);
  });

  it("costs a bad line that line and nothing else", () => {
    // Throwing here would turn one malformed record into a review nobody
    // gets, which is the wrong trade for a reporting path.
    const text = `not json\n${JSON.stringify({ type: "finding", ...finding() })}\n{"type":"other"}\n`;
    const records = parseRecords(text);
    expect(records.findings).toHaveLength(1);
    expect(records.unreadable).toBe(2);
  });

  it("refuses a finding with no path or no body", () => {
    const records = parseRecords(
      ndjson({ type: "finding", ...finding({ path: "" }) }, { type: "finding", body: "" }),
    );
    expect(records.findings).toHaveLength(0);
    expect(records.unreadable).toBe(2);
  });

  it("does not trust a line number it was given", () => {
    // A string `line` would reach the API as one and fail the whole review.
    const records = parseRecords(
      ndjson(
        { type: "finding", ...finding(), line: "12" },
        { type: "finding", ...finding(), line: -3 },
      ),
    );
    expect(records.findings.map((f) => f.line)).toEqual([null, null]);
  });

  it("reads an empty stream as an empty run", () => {
    expect(parseRecords("")).toEqual({ findings: [], summary: null, unreadable: 0 });
  });
});

describe("building the review", () => {
  it("anchors a finding inline and keeps its skills visible", () => {
    const stream = ndjson({ type: "finding", ...finding({ skills: ["medusa-route"] }) });
    const review = buildReview(parseRecords(stream));
    expect(review.comments).toEqual([
      {
        path: "src/a.ts",
        line: 12,
        body: expect.stringContaining("Null check missing.") as string,
      },
    ]);
    expect(review.comments[0]?.body).toContain("skills: medusa-route");
  });

  it("spans a real multi-line anchor and ignores a fake one", () => {
    const span = buildReview({
      findings: [finding({ start_line: 9 })],
      summary: null,
      unreadable: 0,
    });
    expect(span.comments[0]?.start_line).toBe(9);
    // `start_line === line` is a single-line anchor spelled the long way;
    // some providers reject it outright.
    const flat = buildReview({
      findings: [finding({ start_line: 12 })],
      summary: null,
      unreadable: 0,
    });
    expect(flat.comments[0]).not.toHaveProperty("start_line");
  });

  it("lists an unanchored finding in the body instead of dropping it", () => {
    const review = buildReview({
      findings: [finding({ line: null, body: "Nowhere to point." })],
      summary: null,
      unreadable: 0,
    });
    expect(review.comments).toHaveLength(0);
    expect(review.body).toContain("could not be anchored");
    expect(review.body).toContain("Nowhere to point.");
  });

  it("caps inline comments, keeps the most severe, and names the rest", () => {
    const findings = [
      finding({ severity: "readability", line: 1 }),
      finding({ severity: "bug", line: 2 }),
      finding({ severity: "security", line: 3 }),
    ];
    const review = buildReview({ findings, summary: null, unreadable: 0 }, { maxInline: 2 });
    expect(review.comments.map((c) => c.line)).toEqual([2, 3]);
    expect(review.overflow).toBe(1);
    expect(review.body).toContain("1 further finding(s) not posted inline");
  });

  it("says plainly when nothing was found", () => {
    const review = buildReview({ findings: [], summary: SUMMARY, unreadable: 0 });
    expect(review.body).toContain("No issues found");
    expect(review.comments).toHaveLength(0);
  });

  it("repeats the run's tallies, including what it could not read", () => {
    const review = buildReview({
      findings: [finding()],
      summary: { ...SUMMARY, refuted: 2, capped: 3 },
      unreadable: 1,
    });
    expect(review.body).toContain("2 refuted by verification");
    expect(review.body).toContain("3 withheld by the per-file cap");
    expect(review.body).toContain("1 unreadable record(s)");
  });

  it("posts a comment unless a finding's severity is in the gate", () => {
    const records = parseRecords(
      ndjson(
        { type: "finding", ...finding({ severity: "bug" }) },
        { type: "finding", ...finding({ severity: "readability", line: 20 }) },
      ),
    );
    // No gate: the review informs, the humans decide.
    expect(buildReview(records).event).toBe("comment");
    expect(buildReview(records, { requestChangesOn: [] }).event).toBe("comment");
    // A gate the findings do not meet.
    expect(buildReview(records, { requestChangesOn: ["security"] }).event).toBe("comment");
    // A gate they do; spelled however the caller spelled it.
    expect(buildReview(records, { requestChangesOn: ["Bug"] }).event).toBe("request-changes");
    expect(buildReview(records, { requestChangesOn: ["security", "bug"] }).event).toBe(
      "request-changes",
    );
  });

  it("asks for nothing when nothing was found, whatever the gate", () => {
    expect(reviewEventFor([], ["bug", "security"])).toBe("comment");
  });

  it("meets the gate however the record spelled the severity", () => {
    // The gate is validated (`severityList`), so it is canonical; a severity
    // read off a record stream is not. A gate that read `"Bug"` as something
    // other than `bug` would fail open -- posting a comment where the
    // operator asked for a block.
    for (const spelling of ["bug", "Bug", "BUG", " bug "]) {
      const records = parseRecords(ndjson({ type: "finding", ...finding({ severity: spelling }) }));
      expect(reviewEventFor(records.findings, ["bug"])).toBe("request-changes");
      expect(buildReview(records, { requestChangesOn: ["bug"] }).event).toBe("request-changes");
    }
  });

  it("does not let an unknown severity trip a gate it does not name", () => {
    const records = parseRecords(ndjson({ type: "finding", ...finding({ severity: "typo" }) }));
    expect(reviewEventFor(records.findings, ["bug", "security"])).toBe("comment");
  });

  it("offers the example as a plain fence, never a one-click suggestion", () => {
    // A ```suggestion would let someone commit text nobody checked against
    // the surrounding lines.
    const body = commentBody(finding({ example: "if (x == null) return;" }));
    expect(body).toContain("```\nif (x == null) return;\n```");
    expect(body).not.toContain("```suggestion");
  });
});
