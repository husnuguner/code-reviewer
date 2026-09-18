/**
 * The posting port: what `reviewer comment` needs from a hosting system.
 *
 * One operation -- post one review with inline comments to one change
 * request -- and nothing else. The poster is the half of the split that
 * holds a token, so the port is kept as narrow as the job: a hosting system
 * that could do more through this interface would be a hosting system a
 * stolen token could do more with.
 *
 * Nothing here names GitHub. `owner/name`, `pull_number`, a REST root -- those
 * are one host's reading of the fields below, made outside the core
 * (`providers/repository/github`). A second host (GitLab, Bitbucket, Gerrit)
 * is a second reading, registered alongside, and the command line learns of
 * it from the registry rather than from an edit. The core asks only for a
 * `ReviewPoster`; it does not know there is a choice.
 */

import { type InlineComment } from "../posting/review-payload";

/** A response the hosting system refused, with enough to act on. */
export class PostingError extends Error {
  // `string`, not the literal: a host's own error (`GithubError`) names
  // itself, and a literal type here would forbid exactly that.
  override readonly name: string = "PostingError";

  constructor(
    message: string,
    /** The transport's status, or 0 when the request was never made. */
    readonly status = 0,
  ) {
    super(message);
  }
}

/**
 * What kind of review this is, in the change request's own workflow.
 *
 * `comment` says something; `request-changes` asks for something and stands
 * in the way until it is answered or dismissed. There is deliberately no
 * `approve`: a bot's approval is a human's word given by a machine, and a
 * merge gate that a prompt-injected diff could talk its way past is not a
 * gate.
 */
export type ReviewEvent = "comment" | "request-changes";

/** What one review submission carries, in the port's own terms. */
export interface ReviewSubmission {
  /** The repository as the host names it -- `owner/name` on GitHub. */
  readonly repository: string;
  /** The change request's number. */
  readonly pullNumber: number;
  /** The review's own comment, Markdown. */
  readonly body: string;
  /** Inline comments, already capped and ordered by the payload builder. */
  readonly comments: readonly InlineComment[];
  /** Default `comment`. */
  readonly event?: ReviewEvent;
  /**
   * Dismiss this identity's earlier pending reviews on the change request
   * before posting. Each run then leaves one current verdict rather than a
   * history of them, and a clean run lifts a block an earlier run raised.
   * Default `false`.
   */
  readonly supersede?: boolean;
}

/** What the port reports back: how much of the review landed as intended. */
export interface PostingResult {
  /** Inline comments the host accepted; fewer than sent means a fallback ran. */
  readonly inline: number;
  /** Earlier reviews dismissed by `supersede`; `0` when none were, or it was off. */
  readonly superseded: number;
}

/** Posts one review per call. */
export interface ReviewPoster {
  submit(submission: ReviewSubmission): Promise<PostingResult>;
}
