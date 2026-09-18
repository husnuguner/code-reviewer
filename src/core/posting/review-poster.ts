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
 * are one provider's reading of the fields below, made in `infra/`. A second
 * provider (GitLab, Bitbucket, Gerrit) is a second reading, registered
 * alongside, and the command line learns of it from the registry rather than
 * from an edit.
 */

import { type DescribedEntry } from "../util/registry";

import { type InlineComment } from "./review-payload";

/** A response the hosting system refused, with enough to act on. */
export class PostingError extends Error {
  // `string`, not the literal: a provider's own error (`GithubError`) names
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
  /** The repository as the provider names it -- `owner/name` on GitHub. */
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
  /** Inline comments the provider accepted; fewer than sent means a fallback ran. */
  readonly inline: number;
  /** Earlier reviews dismissed by `supersede`; `0` when none were, or it was off. */
  readonly superseded: number;
}

/** Posts one review per call. */
export interface ReviewPoster {
  submit(submission: ReviewSubmission): Promise<PostingResult>;
}

/** The knobs every poster is built from, read once from the command line. */
export interface PosterSettings {
  /** The credential. Never logged, never a flag. */
  readonly token: string;
  /** API root override; `null` takes the provider's default. */
  readonly baseUrl: string | null;
}

/**
 * One hosting system, as the registry knows it.
 *
 * `tokenVariable` is where the poster reads its credential from: each
 * provider names its own, so a workflow for GitLab sets GITLAB_TOKEN and
 * nothing has to be renamed on the way.
 */
export interface ReviewPosterProvider extends DescribedEntry {
  /** Unique id used in `--provider`. */
  readonly name: string;
  /** One line, shown in `--help`. */
  readonly description: string;
  /** The environment variable the credential is read from. */
  readonly tokenVariable: string;
  /** Build a poster for these settings. */
  create(settings: PosterSettings): ReviewPoster;
}
