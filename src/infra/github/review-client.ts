/**
 * GitHub's reading of the posting port: one review, one endpoint.
 *
 * The narrowest client this repository has on purpose. It knows one endpoint
 * — `POST /repos/{owner}/{repo}/pulls/{n}/reviews` — because the process that
 * runs it must be able to do exactly one thing: say what the reviewer found.
 * It reads no diffs, lists no pull requests and calls no model, so a token
 * handed to it cannot be turned into anything else.
 *
 * `fetch` is injected, so the request, the retry and the error handling are
 * all exercised by tests without a network.
 */

import {
  PostingError,
  type PostingResult,
  type ReviewPoster,
  type ReviewSubmission,
} from "../../core/comment/review-poster";
import { type Logger, NULL_LOGGER } from "../../core/ports/logger";

/**
 * `fetch` as this client calls it: with a `URL`, never a string.
 *
 * The type is the guard. A string can come from anywhere; a `URL` here is
 * produced by `allowedUrl` alone, after the origin check, so nothing that
 * skipped the check can reach the network -- the compiler says so.
 *
 * The client does not name the global. It is handed one by whoever composes
 * it -- the poster registry in production, a recorder in tests -- so this
 * module has no network dependency of its own to audit.
 */
export type FetchLike = (input: URL, init: RequestInit) => Promise<Response>;

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
// eslint-disable-next-line unicorn/name-replacements -- the domain term, not an abbreviation to expand
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
// eslint-disable-next-line unicorn/name-replacements -- the domain term, not an abbreviation to expand
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
  readonly logger?: Logger;
}

const DEFAULT_BASE_URL = "https://api.github.com";

/** Posts one `COMMENT` review per call. */
export class GithubReviewClient implements ReviewPoster {
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly origin: string;
  private readonly fetch: FetchLike;
  private readonly log: Logger;

  constructor(options: ReviewClientOptions) {
    this.token = options.token;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/u, "");
    this.origin = allowedOrigin(this.baseUrl);
    this.fetch = options.fetch;
    this.log = (options.logger ?? NULL_LOGGER).child("comment.github");
  }

  /**
   * Submit the review, retrying once without inline comments.
   *
   * GitHub refuses a whole review when one comment names a line it does not
   * consider commentable, and the diff it will accept is not always the diff
   * the reviewer read (a force-push, a rebase). Losing every finding to one
   * bad anchor is the worst outcome available, so the retry keeps the body —
   * which already lists what did not go inline — and drops the anchors.
   */
  async submit(submission: ReviewSubmission): Promise<PostingResult> {
    const { pullNumber, body, comments } = submission;
    // The port carries the slug as written; splitting and validating it is
    // this provider's reading, made here and nowhere upstream.
    const { owner, repo } = parseRepository(submission.repository);
    const path = `/repos/${owner}/${repo}/pulls/${String(pullNumber)}/reviews`;
    try {
      await this.post(path, { event: "COMMENT", body, comments });
      return { inline: comments.length };
    } catch (error) {
      if (comments.length === 0 || !(error instanceof GithubError)) throw error;
      this.log.warn(
        `GitHub refused the review with ${String(comments.length)} inline comment(s) (${error.message}); retrying with the body alone.`,
      );
      const note = `\n\n> ⚠️ GitHub would not accept the inline comments for this review (${error.detail}); the findings are listed above instead.`;
      await this.post(path, { event: "COMMENT", body: body + note, comments: [] });
      return { inline: 0 };
    }
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

  private async post(path: string, payload: unknown): Promise<void> {
    const response = await this.fetch(this.allowedUrl(path), {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.token}`,
        accept: "application/vnd.github+json",
        "content-type": "application/json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "code-reviewer",
      },
      body: JSON.stringify(payload),
    });
    if (response.ok) return;
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
