/**
 * GitHub's reading of the posting port: one review, one endpoint.
 *
 * The narrowest client this repository has on purpose. It knows one endpoint
 * — `POST /repos/{owner}/{repo}/pulls/{n}/reviews` — because the process that
 * runs it must be able to do exactly one thing: say what the reviewer found.
 * It reads no diffs, lists no pull requests and calls no model, so a token
 * handed to it cannot be turned into anything else.
 *
 * The transport is injected, so the request, the fallback and the error
 * handling are all exercised by tests without a network. Repeating a request
 * the network or the host lost is not this module's business: the transport
 * it is handed has already done that (`providers/http/retrying-fetch`), and what
 * reaches the code below is an answer, not an accident.
 */

import { type Logger, NULL_LOGGER } from "../../../core/ports/logger";
import {
  PostingError,
  type PostingResult,
  type ReviewPoster,
  type ReviewSubmission,
} from "../../../core/ports/review-poster";
import { errorMessage } from "../../../core/util/errors";
import { type FetchLike } from "../../http/fetch-like";

/**
 * The transport's type, re-exported where its one caller reads about it.
 *
 * The client does not name the global. It is handed a transport by whoever
 * composes it -- the poster registry in production, a recorder in tests -- so
 * this module has no network dependency of its own to audit, and `allowedUrl`
 * below is the only thing that can produce an argument for it.
 */
export type { FetchLike } from "../../http/fetch-like";

/** A response GitHub refused, carrying enough to act on it. */
export class GithubError extends PostingError {
  override readonly name = "GithubError";

  constructor(
    status: number,
    readonly detail: string,
  ) {
    super(`GitHub answered ${String(status)}: ${detail}`, status);
  }
}

/**
 * The repository a review is posted to, as `owner` and `name`.
 *
 * Spelled out rather than abbreviated: `Repository` is the domain's word for
 * this (see CONTEXT.md), and a glossary term is not the place to save four
 * characters.
 */
export interface Repository {
  readonly owner: string;
  readonly repo: string;
}

/**
 * What GitHub allows in an owner or a repository name.
 *
 * Enforced rather than assumed: both halves are interpolated into a request
 * path, so a value carrying `/` or `..` would address a different endpoint
 * than the one this client is allowed to call.
 */
const NAME = /^[A-Za-z0-9._-]+$/u;

/** Parse `owner/repo`, refusing anything else. */
export function parseRepository(slug: string): Repository {
  const [owner, repo, ...rest] = slug.trim().split("/");
  if (owner === undefined || repo === undefined || rest.length > 0) {
    throw new GithubError(0, `'${slug}' is not an owner/repo slug`);
  }
  // `.` and `..` pass the character check but address a directory, not a
  // repository, so they are refused by name before the pattern is consulted.
  if (repo === "." || repo === ".." || !NAME.test(owner) || !NAME.test(repo)) {
    throw new GithubError(0, `'${slug}' is not an owner/repo slug`);
  }
  return { owner, repo };
}

/**
 * The origin this client is allowed to reach, from its base URL.
 *
 * One allowlist entry, derived from configuration and checked before every
 * request leaves the process: a base URL taken from the environment cannot
 * point the token at an arbitrary host, and no response can redirect it.
 */
function allowedOrigin(baseUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new GithubError(0, `'${baseUrl}' is not a URL`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new GithubError(0, `'${baseUrl}' is not an http(s) URL`);
  }
  return parsed.origin;
}

export interface ReviewClientOptions {
  readonly token: string;
  /** REST root; GitHub Enterprise uses `https://host/api/v3`. */
  readonly baseUrl?: string;
  /** The transport. Required: see `FetchLike`. */
  readonly fetch: FetchLike;
  /**
   * The login this token posts as, so `supersede` dismisses only this
   * identity's earlier reviews and never a human's. Given rather than looked
   * up: the Actions token may not call `GET /user`. Default: the Actions bot.
   */
  readonly identity?: string;
  readonly logger?: Logger;
}

/** What GitHub calls a review's kind, for each of the port's events. */
const GITHUB_EVENT = { comment: "COMMENT", "request-changes": "REQUEST_CHANGES" } as const;

/** The login `GITHUB_TOKEN` posts as inside GitHub Actions. */
const ACTIONS_BOT = "github-actions[bot]";

/** The shape of one review in `GET /pulls/{n}/reviews`, as far as this client reads it. */
interface ReviewRecord {
  readonly id: number;
  readonly state: string;
  readonly user?: { readonly login?: string } | null;
}

const DEFAULT_BASE_URL = "https://api.github.com";

/** The largest page GitHub will serve; asking for fewer only costs requests. */
const REVIEWS_PER_PAGE = 100;

/**
 * The statuses that refuse the *review*, rather than the caller.
 *
 * What the fallback below can fix is a review GitHub would accept if it
 * carried no anchors. A `401` is a token, a `404` is a pull request, a `500`
 * is GitHub -- none of them changes when the comments are dropped, so
 * retrying them costs a second doomed request and writes a log line blaming
 * the wrong thing. `422` is the one GitHub documents for a comment naming an
 * uncommentable line, and `400` is a malformed body; those two are the
 * fallback's whole reason to exist.
 */
const CONTENT_REFUSAL: ReadonlySet<number> = new Set([400, 422]);

/**
 * How many pages of reviews `supersede` will walk before giving up.
 *
 * A bound rather than a true loop, because this runs against a remote that
 * decides how much there is: 2000 reviews on one pull request is already far
 * past anything real, and a client that would page forever on a misbehaving
 * endpoint is worse than one that stops and says so. Hitting it is logged --
 * the whole point of this pass is that superseding must not fail in silence.
 */
const MAX_REVIEW_PAGES = 20;

/** Posts one `COMMENT` review per call. */
export class GithubReviewClient implements ReviewPoster {
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly origin: string;
  private readonly fetch: FetchLike;
  private readonly identity: string;
  private readonly log: Logger;

  constructor(options: ReviewClientOptions) {
    this.token = options.token;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/u, "");
    this.origin = allowedOrigin(this.baseUrl);
    this.fetch = options.fetch;
    this.identity = options.identity ?? ACTIONS_BOT;
    this.log = (options.logger ?? NULL_LOGGER).child("comment.github");
  }

  /**
   * Submit the review, falling back once to the body without inline comments.
   *
   * GitHub refuses a whole review when one comment names a line it does not
   * consider commentable, and the diff it will accept is not always the diff
   * the reviewer read (a force-push, a rebase). Losing every finding to one
   * bad anchor is the worst outcome available, so the fallback keeps the body
   * — which already lists what did not go inline — and drops the anchors.
   *
   * This is not the transport's retry and must not be confused with it: the
   * transport repeats the *same* request when the network or the host was at
   * fault (see `providers/http/retrying-fetch`), and by the time a refusal
   * reaches here that has already been tried and exhausted. What is left is a
   * refusal of the content, and only the two statuses that mean that one.
   */
  async submit(submission: ReviewSubmission): Promise<PostingResult> {
    const { pullNumber, body, comments } = submission;
    const event = GITHUB_EVENT[submission.event ?? "comment"];
    // The port carries the slug as written; splitting and validating it is
    // this provider's reading, made here and nowhere upstream.
    const { owner, repo } = parseRepository(submission.repository);
    const reviews = `/repos/${owner}/${repo}/pulls/${String(pullNumber)}/reviews`;

    // Dismiss before posting, so the PR never shows two verdicts from the
    // same identity at once -- and a clean run lifts an earlier block even
    // though it posts only a comment.
    const superseded = submission.supersede === true ? await this.dismissPending(reviews) : 0;

    try {
      await this.request("POST", reviews, { event, body, comments });
      return { inline: comments.length, superseded };
    } catch (error) {
      if (
        comments.length === 0 ||
        !(error instanceof GithubError) ||
        !CONTENT_REFUSAL.has(error.status)
      ) {
        throw error;
      }
      this.log.warn(
        `GitHub refused the review with ${String(comments.length)} inline comment(s) (${error.message}); retrying with the body alone.`,
      );
      const note = `\n\n> ⚠️ GitHub would not accept the inline comments for this review (${error.detail}); the findings are listed above instead.`;
      await this.request("POST", reviews, { event, body: body + note, comments: [] });
      return { inline: 0, superseded };
    }
  }

  /**
   * Dismiss this identity's pending reviews on the change request.
   *
   * Only a review that *stands in the way* can be dismissed -- GitHub allows
   * it for CHANGES_REQUESTED and APPROVED, never for a plain comment -- and
   * only ours are touched: dismissing a human's review would be speaking for
   * them. Returns how many were dismissed.
   */
  private async dismissPending(reviews: string): Promise<number> {
    const pending = await this.ourPendingReviews(reviews);
    let dismissed = 0;
    for (const review of pending) {
      try {
        await this.request("PUT", `${reviews}/${String(review.id)}/dismissals`, {
          message: "Superseded by a newer automated review.",
        });
        dismissed++;
      } catch (error) {
        if (!(error instanceof GithubError)) throw error;
        this.log.warn(
          `Could not dismiss review ${String(review.id)} (${error.message}); it stays.`,
        );
      }
    }
    if (dismissed > 0) {
      this.log.info(`Dismissed ${String(dismissed)} earlier review(s) by ${this.identity}.`);
    }
    return dismissed;
  }

  /**
   * Every review of ours that still stands in the way, across every page.
   *
   * Paged rather than read off the first response, and that is not a
   * robustness nicety -- an unpaged read fails in the one direction that
   * matters. GitHub documents that this list "returns in chronological
   * order", so the first page holds the *oldest* reviews and ours are the
   * newest. Once a pull request passes one page, the reviews `supersede`
   * exists to dismiss are exactly the ones an unpaged read cannot see, and
   * it would report nothing to dismiss rather than an error: a clean run
   * would quietly stop lifting the block an earlier run raised. This client
   * is itself what fills such a pull request up, one review per push.
   *
   * Superseding is housekeeping around the review, not the review itself, so
   * a page GitHub refuses is said out loud and whatever was already found is
   * still acted on. Failing here would lose every finding to keep the pull
   * request tidy.
   */
  private async ourPendingReviews(reviews: string): Promise<ReviewRecord[]> {
    const pending: ReviewRecord[] = [];
    for (let page = 1; page <= MAX_REVIEW_PAGES; page++) {
      const query = `per_page=${String(REVIEWS_PER_PAGE)}&page=${String(page)}`;
      let listed: unknown;
      try {
        listed = await this.request("GET", `${reviews}?${query}`);
      } catch (error) {
        if (!(error instanceof GithubError)) throw error;
        this.log.warn(
          `Could not list earlier reviews to supersede (${error.message}); posting anyway.`,
        );
        return pending;
      }
      if (!Array.isArray(listed)) return pending;
      const records = listed as ReviewRecord[];
      pending.push(...records.filter((review) => this.isOursAndPending(review)));
      // A short page is the last page: GitHub fills a page it can fill.
      if (records.length < REVIEWS_PER_PAGE) return pending;
    }
    this.log.warn(
      `Stopped after ${String(MAX_REVIEW_PAGES)} pages of reviews; an earlier review by ${this.identity} may still stand.`,
    );
    return pending;
  }

  /** Ours, and of a kind GitHub will let us dismiss. */
  private isOursAndPending(review: ReviewRecord): boolean {
    return (
      review.user?.login === this.identity &&
      (review.state === "CHANGES_REQUESTED" || review.state === "APPROVED")
    );
  }

  /**
   * The one place a request URL is made, and the allowlist check with it.
   *
   * The path is built from validated names and the origin is the one the base
   * URL named; a URL that will not even parse is refused rather than thrown
   * from. Returning a `URL` (not its string) is what makes the check
   * unskippable: `fetch` accepts nothing else.
   */
  private allowedUrl(path: string): URL {
    const text = `${this.baseUrl}${path}`;
    let target: URL;
    try {
      target = new URL(text);
    } catch {
      throw new GithubError(0, `refusing to call ${text}, which is not a URL`);
    }
    if (target.origin !== this.origin) {
      throw new GithubError(0, `refusing to call ${text}, which is not on ${this.origin}`);
    }
    return target;
  }

  /**
   * One request; the parsed JSON body on success, a `GithubError` otherwise.
   *
   * *Every* failure leaves here as a `GithubError`, the transport's included.
   * A rejected `fetch` -- a refused connection, a dead DNS name, an attempt
   * that ran out of time -- is as much "the hosting system did not accept
   * this review" as a 422 is, and it used to leave as a bare `TypeError`.
   * That mattered beyond tidiness: `PostingError` is what the command line
   * recognises as the operator's problem, so a network failure printed a
   * stack trace and exited 1 where a 422 printed one `error:` line and
   * exited 2. Status `0` is the port's own word for "the request was never
   * answered", which is exactly what happened.
   */
  private async request(
    method: "GET" | "POST" | "PUT",
    path: string,
    payload?: unknown,
  ): Promise<unknown> {
    // Built before the try: `allowedUrl` refuses with a `GithubError` of its
    // own, and catching it here would reword the allowlist as a transport
    // failure.
    const target = this.allowedUrl(path);
    let response: Response;
    try {
      response = await this.fetch(target, {
        method,
        headers: {
          authorization: `Bearer ${this.token}`,
          accept: "application/vnd.github+json",
          "content-type": "application/json",
          "x-github-api-version": "2022-11-28",
          "user-agent": "code-reviewer",
        },
        ...(payload !== undefined && { body: JSON.stringify(payload) }),
      });
    } catch (error) {
      throw new GithubError(0, `${method} ${path} did not complete: ${errorMessage(error)}`);
    }
    if (response.ok) {
      // A dismissal answers with a body; a listing does too. Neither is fatal
      // when unreadable -- the call succeeded.
      try {
        return await response.json();
      } catch {
        return null;
      }
    }
    // The body is where GitHub says *which* comment it disliked, so it is
    // carried into the error rather than reduced to a status code. A body
    // that cannot be read must not replace the status with a stack trace.
    let detail: string;
    try {
      detail = await response.text();
    } catch {
      detail = "";
    }
    throw new GithubError(response.status, detail.trim().slice(0, 500) || response.statusText);
  }
}
