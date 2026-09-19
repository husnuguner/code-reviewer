/**
 * The posting port: one review with inline comments to one change request. Names no host.
 * @packageDocumentation
 */

import { type InlineComment } from "../posting/review-payload";

/** A response the hosting system refused. */
export class PostingError extends Error {
  /** `string`, not a literal, so a host's own error class may name itself. */
  override readonly name: string = "PostingError";

  constructor(
    message: string,
    /** The transport's status, or `0` when the request was never made. */
    readonly status = 0,
  ) {
    super(message);
  }
}

/**
 * The kind of review, in the change request's workflow.
 *
 * @remarks Deliberately no `approve`: a merge gate a prompt-injected diff could pass is not a gate.
 */
export type ReviewEvent = "comment" | "request-changes";

/** One review submission, in the port's own terms. */
export interface ReviewSubmission {
  /** The repository as the host names it (`owner/name` on GitHub). */
  readonly repository: string;
  /** The change request's number. */
  readonly pullNumber: number;
  /** The review's own comment, Markdown. */
  readonly body: string;
  /** Inline comments, already capped and ordered. */
  readonly comments: readonly InlineComment[];
  /** Default `comment`. */
  readonly event?: ReviewEvent;
  /** Dismiss this identity's earlier pending reviews first, so one verdict stands. Default `false`. */
  readonly supersede?: boolean;
}

/** How much of the review landed as intended. */
export interface PostingResult {
  /** Inline comments the host accepted; fewer than sent means a fallback ran. */
  readonly inline: number;
  /** Earlier reviews dismissed by `supersede`. */
  readonly superseded: number;
}

/** Posts one review per call. */
export interface ReviewPoster {
  submit(submission: ReviewSubmission): Promise<PostingResult>;
}
