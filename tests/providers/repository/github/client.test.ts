/**
 * GitHub's reading of the posting port: one review, one endpoint.
 *
 * `fetch` is injected, so the request, the retry, the supersede walk and the
 * error handling are all exercised without a network.
 */

import { describe, expect, it } from "bun:test";

import { COMMENT_MARKER } from "../../../../src/core/posting/review-payload";
import {
  GithubError,
  GithubReviewClient,
  parseRepository,
} from "../../../../src/providers/repository/github/client";
import { recordingLogger } from "../../../helpers/logging";

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

/**
 * Which page a listing call asked for.
 *
 * Read off the query rather than matched as a substring: `per_page=100`
 * contains `page=1`, so a naive `includes` answers "page one" for every
 * page and a pagination test silently stops testing pagination.
 */

/**
 * Which page a listing call asked for.
 *
 * Read off the query rather than matched as a substring: `per_page=100`
 * contains `page=1`, so a naive `includes` answers "page one" for every
 * page and a pagination test silently stops testing pagination.
 */
function pageOf(call: RecordedCall): string | null {
  return new URL(call.url).searchParams.get("page");
}

const ok = (): Response => new Response("{}", { status: 200 });

/** A transport for a test that must never reach it. */
function neverCalled(): Promise<Response> {
  throw new Error("fetch must not be called");
}

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

  it("posts first, then dismisses its own pending reviews when superseding, and only those", async () => {
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
      "POST /repos/acme/app/pulls/7/reviews",
      "GET /repos/acme/app/pulls/7/reviews?per_page=100&page=1",
      "PUT /repos/acme/app/pulls/7/reviews/1/dismissals",
      "PUT /repos/acme/app/pulls/7/reviews/3/dismissals",
    ]);
    expect(calls[2]?.body).toMatchObject({
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
    expect(calls[2]?.url).toContain("/reviews/2/dismissals");
  });

  it("dismisses nothing when the review itself could not be posted", async () => {
    // Dismissing first and failing to post would lift an earlier block with no verdict in its place.
    const calls: RecordedCall[] = [];
    const responder = (call: RecordedCall): Response =>
      call.method === "POST"
        ? new Response("unavailable", { status: 500 })
        : Response.json([listed(1, "CHANGES_REQUESTED")]);
    await expect(
      clientWith(responder, calls).submit({
        repository: repo,
        pullNumber: 7,
        body: "b",
        comments: [],
        supersede: true,
      }),
    ).rejects.toThrow(GithubError);
    expect(calls.map((call) => call.method)).toEqual(["POST"]);
  });

  it("never dismisses the review it has just posted", async () => {
    const calls: RecordedCall[] = [];
    const responder = (call: RecordedCall): Response => {
      if (call.method === "POST") return Response.json({ id: 42 });
      return call.method === "GET"
        ? Response.json([listed(41, "CHANGES_REQUESTED"), listed(42, "CHANGES_REQUESTED")])
        : ok();
    };
    const result = await clientWith(responder, calls).submit({
      repository: repo,
      pullNumber: 7,
      body: "b",
      comments: [],
      event: "request-changes",
      supersede: true,
    });
    expect(result.superseded).toBe(1);
    expect(calls.filter((call) => call.method === "PUT").map((call) => call.url)).toEqual([
      "https://api.github.com/repos/acme/app/pulls/7/reviews/41/dismissals",
    ]);
  });

  it("leaves earlier reviews standing when it cannot tell its new request for changes from them", async () => {
    const calls: RecordedCall[] = [];
    const lines: string[] = [];
    const client = new GithubReviewClient({
      token: "t",
      logger: recordingLogger(lines),
      fetch: (target, init) => {
        calls.push({ method: init.method ?? "GET", url: target.toString(), body: null });
        return Promise.resolve(ok());
      },
    });
    const result = await client.submit({
      repository: repo,
      pullNumber: 7,
      body: "b",
      comments: [],
      event: "request-changes",
      supersede: true,
    });
    expect(result.superseded).toBe(0);
    expect(calls.map((call) => call.method)).toEqual(["POST"]);
    expect(lines.join("\n")).toContain("left standing");
  });

  it("keeps its posted review when a dismissal is refused, and says so", async () => {
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
    expect(calls.map((call) => call.method)).toEqual(["POST", "GET", "PUT"]);
    expect(lines.join("\n")).toContain("WARNING Could not dismiss review 1");
  });

  it("walks past the first page, where its own newest reviews are", async () => {
    // GitHub documents that this list "returns in chronological order", so
    // page one holds the OLDEST reviews and ours are the newest. An unpaged
    // read would find nothing to dismiss on a busy pull request and report
    // that as success -- a clean run silently failing to lift an earlier
    // block. This client is what fills such a pull request up, one review
    // per push, so it is its own worst case.
    const calls: RecordedCall[] = [];
    const full = Array.from({ length: 100 }, (_, index) => listed(index + 1, "COMMENTED"));
    const responder = (call: RecordedCall): Response => {
      if (call.method !== "GET") return ok();
      // Page 1 is full and holds nothing of ours; page 2 is short and holds
      // the review that actually stands in the way.
      return pageOf(call) === "1"
        ? Response.json(full, { status: 200 })
        : Response.json([listed(101, "CHANGES_REQUESTED")], { status: 200 });
    };
    const result = await clientWith(responder, calls).submit({
      repository: repo,
      pullNumber: 7,
      body: "b",
      comments: [],
      supersede: true,
    });
    expect(result.superseded).toBe(1);
    expect(
      calls.map((call) => `${call.method} ${call.url.replace("https://api.github.com", "")}`),
    ).toEqual([
      "POST /repos/acme/app/pulls/7/reviews",
      "GET /repos/acme/app/pulls/7/reviews?per_page=100&page=1",
      "GET /repos/acme/app/pulls/7/reviews?per_page=100&page=2",
      "PUT /repos/acme/app/pulls/7/reviews/101/dismissals",
    ]);
  });

  it("stops at the first short page rather than asking for one more", async () => {
    const calls: RecordedCall[] = [];
    const responder = (call: RecordedCall): Response =>
      call.method === "GET" ? Response.json([listed(1, "CHANGES_REQUESTED")]) : ok();
    await clientWith(responder, calls).submit({
      repository: repo,
      pullNumber: 7,
      body: "b",
      comments: [],
      supersede: true,
    });
    expect(calls.filter((call) => call.method === "GET")).toHaveLength(1);
  });

  it("still dismisses what it found when a later page is refused", async () => {
    // Housekeeping must not cost the review, and a half-read list is still
    // worth acting on: the alternative is leaving a block standing because
    // page three timed out.
    const calls: RecordedCall[] = [];
    const full = [
      listed(1, "CHANGES_REQUESTED"),
      ...Array.from({ length: 99 }, (_, index) => listed(index + 2, "COMMENTED")),
    ];
    const responder = (call: RecordedCall): Response => {
      if (call.method !== "GET") return ok();
      return pageOf(call) === "1"
        ? Response.json(full, { status: 200 })
        : new Response("boom", { status: 500 });
    };
    const result = await clientWith(responder, calls).submit({
      repository: repo,
      pullNumber: 7,
      body: "b",
      comments: [],
      supersede: true,
    });
    expect(result.superseded).toBe(1);
    expect(calls[0]?.method).toBe("POST");
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
    expect(calls.map((call) => call.method)).toEqual(["POST", "GET"]);
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

/** One inline comment as `GET /pulls/{n}/comments` lists it, ours unless told otherwise. */
function comment(
  path: string,
  line: number | null,
  start_line: number | null = null,
  body = `**[Bug]** x\n\n${COMMENT_MARKER}`,
): unknown {
  return { id: 1, path, line, start_line, body, user: { login: "github-actions[bot]" } };
}

/** A pull request with two of ours, one outdated, a human's, and a comment without a path. */
function mixedComments(): Response {
  return Response.json(
    [
      comment("src/a.ts", 12),
      comment("src/a.ts", 20, 14),
      comment("src/b.ts", null, null),
      comment("src/c.ts", 3, null, "A human wrote this on the same line."),
      // A human who pasted our marker: the marker alone does not make a comment ours.
      { ...(comment("src/d.ts", 5) as object), user: { login: "a-human" } },
      { id: 9, body: COMMENT_MARKER }, // no path: cannot be placed
    ],
    { status: 200 },
  );
}

describe("what earlier runs already put on the pull request", () => {
  const target = { repository: "acme/app", pullNumber: 7 };

  it("reads the inline comments, keeps only ours -- our marker, our author -- at their current lines", async () => {
    const calls: RecordedCall[] = [];
    const ours = await clientWith(mixedComments, calls).postedComments(target);
    expect(ours).toEqual([
      { path: "src/a.ts", line: 12, start_line: null },
      { path: "src/a.ts", line: 20, start_line: 14 },
      { path: "src/b.ts", line: null, start_line: null },
    ]);
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      "GET https://api.github.com/repos/acme/app/pulls/7/comments?per_page=100&page=1",
    ]);
  });

  it("counts only the comments of the identity it was given", async () => {
    const ours = await clientWith(mixedComments, [], "review-bot").postedComments(target);
    expect(ours).toEqual([]);
  });

  it("walks every full page and stops at the first short one", async () => {
    const calls: RecordedCall[] = [];
    const full = Array.from({ length: 100 }, (_, index) => comment("src/a.ts", index + 1));
    const responder = (call: RecordedCall): Response =>
      pageOf(call) === "1"
        ? Response.json(full, { status: 200 })
        : Response.json([comment("src/a.ts", 500)], { status: 200 });
    const ours = await clientWith(responder, calls).postedComments(target);
    expect(ours).toHaveLength(101);
    expect(calls.map(pageOf)).toEqual(["1", "2"]);
  });

  it("answers with nothing, and says so, when GitHub refuses the listing", async () => {
    const lines: string[] = [];
    const client = new GithubReviewClient({
      token: "t",
      fetch: () => Promise.resolve(new Response("nope", { status: 403 })),
      logger: recordingLogger(lines),
    });
    expect(await client.postedComments(target)).toEqual([]);
    expect(lines).toEqual([
      "WARNING Could not list the pull request's inline comments (GitHub answered 403: nope); posting every finding.",
    ]);
  });

  it("answers with nothing for a slug it cannot read, without a request", async () => {
    const calls: RecordedCall[] = [];
    const ours = await clientWith(ok, calls).postedComments({ ...target, repository: "a/../b" });
    expect(ours).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("answers with nothing when the listing is not a list", async () => {
    expect(await clientWith(ok).postedComments(target)).toEqual([]);
  });
});
