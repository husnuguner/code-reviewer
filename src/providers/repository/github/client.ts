/**
 * GitHub's `ReviewPoster`: one endpoint, `POST /repos/{owner}/{repo}/pulls/{n}/reviews`. Reads no diffs,
 * calls no model. The transport is injected and has already retried; what reaches here is an answer.
 * @packageDocumentation
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

/** The transport's type, re-exported for this client's one caller. */
export type { FetchLike } from "../../http/fetch-like";

/** A response GitHub refused. */
export class GithubError extends PostingError {
  override readonly name = "GithubError";

  constructor(
    status: number,
    /** GitHub's response body, or the client's own reason. */
    readonly detail: string,
  ) {
    super(`GitHub answered ${String(status)}: ${detail}`, status);
  }
}

/** The repository a review is posted to. */
export interface Repository {
  readonly owner: string;
  readonly repo: string;
}

/** What GitHub allows in an owner or repository name. Enforced because both are interpolated into a path. */
const NAME = /^[A-Za-z0-9._-]+$/u;

/**
 * Parses an `owner/repo` slug.
 *
 * @throws {@link GithubError} (status `0`) for anything else, including `.` and `..`.
 */
export function parseRepository(slug: string): Repository {
  const [owner, repo, ...rest] = slug.trim().split("/");
  if (owner === undefined || repo === undefined || rest.length > 0) {
    throw new GithubError(0, `'${slug}' is not an owner/repo slug`);
  }
  if (repo === "." || repo === ".." || !NAME.test(owner) || !NAME.test(repo)) {
    throw new GithubError(0, `'${slug}' is not an owner/repo slug`);
  }
  return { owner, repo };
}

/**
 * The one origin this client may reach, from its base URL.
 *
 * @throws {@link GithubError} when the base URL is not an http(s) URL.
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

/** Options for {@link GithubReviewClient}. */
export interface ReviewClientOptions {
  readonly token: string;
  /** REST root; GitHub Enterprise uses `https://host/api/v3`. */
  readonly baseUrl?: string;
  /** The transport. */
  readonly fetch: FetchLike;
  /** The login this token posts as, so `supersede` dismisses only its own reviews. Default: the Actions bot. */
  readonly identity?: string;
  readonly logger?: Logger;
}

/** GitHub's name for each of the port's events. */
const GITHUB_EVENT = { comment: "COMMENT", "request-changes": "REQUEST_CHANGES" } as const;

/** The login `GITHUB_TOKEN` posts as inside GitHub Actions. */
const ACTIONS_BOT = "github-actions[bot]";

/** One review in `GET /pulls/{n}/reviews`, as far as this client reads it. */
interface ReviewRecord {
  readonly id: number;
  readonly state: string;
  readonly user?: { readonly login?: string } | null;
}

const DEFAULT_BASE_URL = "https://api.github.com";

/** The largest page GitHub serves. */
const REVIEWS_PER_PAGE = 100;

/** Statuses that refuse the review's content (an uncommentable line, a malformed body), which dropping the anchors can fix. */
const CONTENT_REFUSAL: ReadonlySet<number> = new Set([400, 422]);

/** Pages of reviews `supersede` walks before giving up; hitting it is logged. */
const MAX_REVIEW_PAGES = 20;

/** Posts one review per call. */
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
   * Submits the review, falling back once to the body alone when GitHub refuses the inline comments.
   *
   * @returns How many comments landed inline and how many earlier reviews were dismissed.
   * @throws {@link GithubError} on any refusal the fallback cannot fix.
   * @remarks Not the transport's retry: that repeated the same request; this drops the anchors on a content refusal.
   */
  async submit(submission: ReviewSubmission): Promise<PostingResult> {
    const { pullNumber, body, comments } = submission;
    const event = GITHUB_EVENT[submission.event ?? "comment"];
    const { owner, repo } = parseRepository(submission.repository);
    const reviews = `/repos/${owner}/${repo}/pulls/${String(pullNumber)}/reviews`;

    // Dismiss before posting, so one verdict stands and a clean run lifts an earlier block.
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
   * Dismisses this identity's pending reviews (`CHANGES_REQUESTED`, `APPROVED`); never a human's.
   *
   * @returns How many were dismissed. A dismissal GitHub refuses is logged and left standing.
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
   * @remarks Paged because GitHub lists oldest first, so ours are on the last page. A page GitHub refuses is
   * logged and whatever was found is still acted on.
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
      if (records.length < REVIEWS_PER_PAGE) return pending;
    }
    this.log.warn(
      `Stopped after ${String(MAX_REVIEW_PAGES)} pages of reviews; an earlier review by ${this.identity} may still stand.`,
    );
    return pending;
  }

  /** Ours, and of a kind GitHub lets us dismiss. */
  private isOursAndPending(review: ReviewRecord): boolean {
    return (
      review.user?.login === this.identity &&
      (review.state === "CHANGES_REQUESTED" || review.state === "APPROVED")
    );
  }

  /**
   * The one place a request URL is made, with the origin allowlist check.
   *
   * @returns A `URL`, which is all the transport accepts, so the check cannot be skipped.
   * @throws {@link GithubError} when the result is not a URL or not on the allowed origin.
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
   * One request.
   *
   * @returns The parsed JSON body on success, or `null` when it is unreadable.
   * @throws {@link GithubError} for every failure, the transport's included (status `0`), so the CLI treats
   * a network failure like a 422: one `error:` line, exit 2.
   */
  private async request(
    method: "GET" | "POST" | "PUT",
    path: string,
    payload?: unknown,
  ): Promise<unknown> {
    // Built before the try so an allowlist refusal is not reworded as a transport failure.
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
      try {
        return await response.json();
      } catch {
        return null;
      }
    }
    // The body says which comment GitHub disliked, so it travels with the error.
    let detail: string;
    try {
      detail = await response.text();
    } catch {
      detail = "";
    }
    throw new GithubError(response.status, detail.trim().slice(0, 500) || response.statusText);
  }
}
