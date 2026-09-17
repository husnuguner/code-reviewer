/**
 * The posting half: NDJSON in, one review out.
 *
 * This used to be a script inlined in a workflow, where nothing typechecked
 * it and nothing could run it. Here the shape of a review is pinned without a
 * token, a network or a model — which is the only way the CI bot's behaviour
 * is reviewable at all.
 */

import { describe, expect, it } from "vitest";

import {
  type Finding,
  buildReview,
  commentBody,
  parseRecords,
} from "../src/core/comment/review-payload";
import { type SummaryRecord } from "../src/core/ports/review-reporter";
import {
  GithubError,
  GithubReviewClient,
  // eslint-disable-next-line unicorn/name-replacements -- `Repository` is the domain term (CONTEXT.md), not an abbreviation
  parseRepository,
} from "../src/infra/github/review-client";

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
  findings: 1,
  files_with_findings: 1,
  anchors: { exact: 1 },
  unanchored: 0,
  refuted: 0,
  capped: 0,
  skipped: {},
};

/** The record stream as the reviewer writes it. */
function ndjson(...records: unknown[]): string {
  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

/** One request the client made, as the fake `fetch` recorded it. */
interface RecordedCall {
  readonly url: string;
  readonly body: unknown;
}

/** A client whose `fetch` answers from `responder` and records every call. */
function clientWith(responder: () => Response, calls: RecordedCall[] = []): GithubReviewClient {
  return new GithubReviewClient({
    token: "t",
    fetch: (url, init) => {
      // Only a string body is ever sent here, and a test that started
      // sending something else should fail loudly rather than record
      // "[object Object]".
      const raw = typeof init.body === "string" ? init.body : "";
      calls.push({ url, body: JSON.parse(raw) as unknown });
      return Promise.resolve(responder());
    },
  });
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

  it("offers the example as a plain fence, never a one-click suggestion", () => {
    // A ```suggestion would let someone commit text nobody checked against
    // the surrounding lines.
    const body = commentBody(finding({ example: "if (x == null) return;" }));
    expect(body).toContain("```\nif (x == null) return;\n```");
    expect(body).not.toContain("```suggestion");
  });
});

describe("the repository slug", () => {
  it("takes owner/name", () => {
    expect(parseRepository(" acme/app ")).toEqual({ owner: "acme", repo: "app" });
  });

  it.each([["acme"], ["acme/app/extra"], ["/app"], ["acme/"], ["acme/.."], ["ac me/app"]])(
    "refuses %s",
    (slug) => {
      expect(() => parseRepository(slug)).toThrow(GithubError);
    },
  );
});

describe("posting the review", () => {
  const repo = { owner: "acme", repo: "app" };

  it("posts one COMMENT review to the pull request's endpoint", async () => {
    const calls: RecordedCall[] = [];
    const result = await clientWith(() => new Response("{}", { status: 200 }), calls).submit({
      repository: repo,
      pullNumber: 7,
      body: "b",
      comments: [{ path: "a.ts", line: 1, body: "c" }],
    });
    expect(result.inline).toBe(1);
    expect(calls[0]?.url).toBe("https://api.github.com/repos/acme/app/pulls/7/reviews");
    expect(calls[0]?.body).toMatchObject({ event: "COMMENT", body: "b" });
  });

  it("retries without inline comments when GitHub refuses them", async () => {
    // Losing every finding to one bad anchor is the worst outcome available.
    const calls: RecordedCall[] = [];
    let isFirst = true;
    const responder = (): Response => {
      if (isFirst) {
        isFirst = false;
        return new Response('{"message":"line must be part of the diff"}', { status: 422 });
      }
      return new Response("{}", { status: 200 });
    };
    const result = await clientWith(responder, calls).submit({
      repository: repo,
      pullNumber: 7,
      body: "b",
      comments: [{ path: "a.ts", line: 999, body: "c" }],
    });
    expect(result.inline).toBe(0);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.body).toMatchObject({ comments: [] });
    expect(JSON.stringify(calls[1]?.body)).toContain("would not accept the inline comments");
  });

  it("gives up when even the body is refused", async () => {
    await expect(
      clientWith(() => new Response("nope", { status: 403 })).submit({
        repository: repo,
        pullNumber: 7,
        body: "b",
        comments: [],
      }),
    ).rejects.toThrow(GithubError);
  });

  it("refuses a base URL that is not http(s)", () => {
    expect(() => new GithubReviewClient({ token: "t", baseUrl: "file:///etc" })).toThrow(
      GithubError,
    );
  });
});
