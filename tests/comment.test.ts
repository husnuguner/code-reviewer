/**
 * The posting half: NDJSON in, one review out.
 *
 * This used to be a script inlined in a workflow, where nothing typechecked
 * it and nothing could run it. Here the shape of a review is pinned without a
 * token, a network or a model — which is the only way the CI bot's behaviour
 * is reviewable at all.
 */

import { describe, expect, it } from "vitest";

import { parseArguments } from "../src/cli/comment";
import { UsageError } from "../src/cli/program";
import { type SummaryRecord } from "../src/core/ports/review-reporter";
import {
  type Finding,
  buildReview,
  commentBody,
  parseRecords,
  reviewEventFor,
} from "../src/core/posting/review-payload";
import { PostingError } from "../src/core/posting/review-poster";
import { ValueError } from "../src/core/util/errors";
import {
  GithubError,
  GithubReviewClient,
  // eslint-disable-next-line unicorn/name-replacements -- `Repository` is the domain term (CONTEXT.md), not an abbreviation
  parseRepository,
} from "../src/infra/github/review-client";
import { builtinReviewPosterRegistry } from "../src/infra/posters/index";

import { recordingLogger } from "./helpers/logging";

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
  readonly method: string;
  readonly url: string;
  /** The JSON body, or `null` for a request that carried none (a GET). */
  readonly body: unknown;
}

/** A client whose `fetch` answers from `responder` and records every call. */
function clientWith(
  responder: (call: RecordedCall) => Response,
  calls: RecordedCall[] = [],
  identity?: string,
): GithubReviewClient {
  return new GithubReviewClient({
    token: "t",
    ...(identity !== undefined && { identity }),
    // The client hands over a `URL` it produced after its origin allowlist;
    // recording it as text is only for the assertions below.
    fetch: (target, init) => {
      const url = target.toString();
      // Only a string body is ever sent here, and a test that started
      // sending something else should fail loudly rather than record
      // "[object Object]".
      const raw = typeof init.body === "string" ? init.body : "";
      const call: RecordedCall = {
        method: init.method ?? "GET",
        url,
        body: raw === "" ? null : (JSON.parse(raw) as unknown),
      };
      calls.push(call);
      return Promise.resolve(responder(call));
    },
  });
}

/** One review as `GET /pulls/{n}/reviews` lists it, as far as the client reads. */
function listed(id: number, state: string, login = "github-actions[bot]"): unknown {
  return { id, state, user: { login } };
}

const ok = (): Response => new Response("{}", { status: 200 });

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
  // The slug as the command line carries it: splitting and validating it is
  // the provider's business, exercised through `submit`.
  const repo = "acme/app";

  it("posts one COMMENT review to the pull request's endpoint", async () => {
    const calls: RecordedCall[] = [];
    const result = await clientWith(ok, calls).submit({
      repository: repo,
      pullNumber: 7,
      body: "b",
      comments: [{ path: "a.ts", line: 1, body: "c" }],
    });
    expect(result).toEqual({ inline: 1, superseded: 0 });
    // Without `supersede`, nothing is listed or dismissed: one request.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.url).toBe("https://api.github.com/repos/acme/app/pulls/7/reviews");
    expect(calls[0]?.body).toMatchObject({ event: "COMMENT", body: "b" });
  });

  it("posts REQUEST_CHANGES when the review asks for changes", async () => {
    const calls: RecordedCall[] = [];
    await clientWith(ok, calls).submit({
      repository: repo,
      pullNumber: 7,
      body: "b",
      comments: [],
      event: "request-changes",
    });
    expect(calls[0]?.body).toMatchObject({ event: "REQUEST_CHANGES" });
  });

  it("keeps the event on the retry without inline comments", async () => {
    const calls: RecordedCall[] = [];
    const responder = (call: RecordedCall): Response =>
      calls.length === 1 && call.method === "POST"
        ? new Response('{"message":"line must be part of the diff"}', { status: 422 })
        : ok();
    await clientWith(responder, calls).submit({
      repository: repo,
      pullNumber: 7,
      body: "b",
      comments: [{ path: "a.ts", line: 999, body: "c" }],
      event: "request-changes",
    });
    // The verdict does not soften because an anchor was refused.
    expect(calls[1]?.body).toMatchObject({ event: "REQUEST_CHANGES", comments: [] });
  });

  it("dismisses its own pending reviews first when superseding, and only those", async () => {
    const calls: RecordedCall[] = [];
    const responder = (call: RecordedCall): Response =>
      call.method === "GET"
        ? Response.json(
            [
              listed(1, "CHANGES_REQUESTED"),
              listed(2, "COMMENTED"), // cannot be dismissed; GitHub would refuse
              listed(3, "APPROVED"),
              listed(4, "CHANGES_REQUESTED", "a-human"), // not ours to dismiss
              listed(5, "DISMISSED"),
            ],
            { status: 200 },
          )
        : ok();
    const result = await clientWith(responder, calls).submit({
      repository: repo,
      pullNumber: 7,
      body: "b",
      comments: [],
      supersede: true,
    });
    expect(result.superseded).toBe(2);
    expect(
      calls.map((call) => `${call.method} ${call.url.replace("https://api.github.com", "")}`),
    ).toEqual([
      "GET /repos/acme/app/pulls/7/reviews?per_page=100",
      "PUT /repos/acme/app/pulls/7/reviews/1/dismissals",
      "PUT /repos/acme/app/pulls/7/reviews/3/dismissals",
      "POST /repos/acme/app/pulls/7/reviews",
    ]);
    expect(calls[1]?.body).toMatchObject({
      message: expect.stringContaining("Superseded") as string,
    });
  });

  it("dismisses as the identity it was given, not always the Actions bot", async () => {
    const calls: RecordedCall[] = [];
    const responder = (call: RecordedCall): Response =>
      call.method === "GET"
        ? Response.json(
            [
              listed(1, "CHANGES_REQUESTED"), // github-actions[bot]: not ours this time
              listed(2, "CHANGES_REQUESTED", "review-bot"),
            ],
            { status: 200 },
          )
        : ok();
    const result = await clientWith(responder, calls, "review-bot").submit({
      repository: repo,
      pullNumber: 7,
      body: "b",
      comments: [],
      supersede: true,
    });
    expect(result.superseded).toBe(1);
    expect(calls[1]?.url).toContain("/reviews/2/dismissals");
  });

  it("still posts when a dismissal is refused, and says so", async () => {
    // Housekeeping around the review must not cost the review.
    const calls: RecordedCall[] = [];
    const lines: string[] = [];
    const client = new GithubReviewClient({
      token: "t",
      logger: recordingLogger(lines),
      fetch: (target, init) => {
        const method = init.method ?? "GET";
        calls.push({ method, url: target.toString(), body: null });
        if (method === "GET")
          return Promise.resolve(Response.json([listed(1, "CHANGES_REQUESTED")]));
        return method === "PUT"
          ? Promise.resolve(new Response("forbidden", { status: 403 }))
          : Promise.resolve(ok());
      },
    });
    const result = await client.submit({
      repository: repo,
      pullNumber: 7,
      body: "b",
      comments: [],
      supersede: true,
    });
    expect(result.superseded).toBe(0);
    expect(calls.map((call) => call.method)).toEqual(["GET", "PUT", "POST"]);
    expect(lines.join("\n")).toContain("WARNING Could not dismiss review 1");
  });

  it("supersedes nothing when there is nothing pending, and still posts", async () => {
    const calls: RecordedCall[] = [];
    const responder = (call: RecordedCall): Response =>
      call.method === "GET" ? new Response("[]", { status: 200 }) : ok();
    const result = await clientWith(responder, calls).submit({
      repository: repo,
      pullNumber: 7,
      body: "b",
      comments: [],
      supersede: true,
    });
    expect(result.superseded).toBe(0);
    expect(calls.map((call) => call.method)).toEqual(["GET", "POST"]);
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
    expect(result.superseded).toBe(0);
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
    expect(
      () => new GithubReviewClient({ token: "t", baseUrl: "file:///etc", fetch: neverCalled }),
    ).toThrow(GithubError);
  });

  it("refuses a slug the provider cannot read, before any request is made", async () => {
    const calls: RecordedCall[] = [];
    await expect(
      clientWith(() => new Response("{}", { status: 200 }), calls).submit({
        repository: "acme/../app",
        pullNumber: 7,
        body: "b",
        comments: [],
      }),
    ).rejects.toThrow(GithubError);
    expect(calls).toHaveLength(0);
  });
});

describe("the command line", () => {
  const required = ["--findings", "f.ndjson", "--repo", "acme/app", "--pr", "7"];

  it("comments, and supersedes nothing, unless asked", () => {
    const parsed = parseArguments(required);
    expect(parsed.requestChangesOn).toEqual([]);
    expect(parsed.supersede).toBe(false);
  });

  it("takes the severities that make a review a request for changes", () => {
    const parsed = parseArguments([...required, "--request-changes-on", "Bug, security"]);
    expect(parsed.requestChangesOn).toEqual(["bug", "security"]);
    // `none` is the spelled-out way to say "never", and it is the default.
    expect(parseArguments([...required, "--request-changes-on", "none"]).requestChangesOn).toEqual(
      [],
    );
  });

  it("refuses a severity the vocabulary does not have", () => {
    expect(() => parseArguments([...required, "--request-changes-on", "blocker"])).toThrow(
      UsageError,
    );
  });

  it("supersedes when asked", () => {
    expect(parseArguments([...required, "--supersede"]).supersede).toBe(true);
  });
});

/** A transport for a test that must never reach it. */
function neverCalled(): Promise<Response> {
  throw new Error("fetch must not be called");
}

describe("the poster registry", () => {
  const registry = builtinReviewPosterRegistry();

  it("knows GitHub, and says which variable its token lives in", () => {
    expect(registry.names()).toEqual(["github"]);
    expect(registry.get("github").tokenVariable).toBe("GITHUB_TOKEN");
    expect(registry.describe()).toContain("'github'");
  });

  it("names the providers that exist when asked for one that does not", () => {
    // The message is what a user with a typo reads; it must list the answer.
    expect(() => registry.get("gitlab")).toThrow(ValueError);
    expect(() => registry.get("gitlab")).toThrow(/'github'/u);
  });

  it("builds a poster that speaks the port, whatever the provider", async () => {
    // Through the registry, not the class: this is the path review-comment
    // takes, and it must not know it is talking to GitHub.
    const poster = registry.create("github", { token: "t", baseUrl: null });
    await expect(
      poster.submit({ repository: "not a slug", pullNumber: 1, body: "b", comments: [] }),
    ).rejects.toThrow(PostingError);
  });
});
