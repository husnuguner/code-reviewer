/**
 * `reviewer comment`: reads the records, asks the host what earlier runs already said, builds the review,
 * posts it. A stream with no findings is still posted.
 * @packageDocumentation
 */

import { readFileSync } from "node:fs";

import { type ReviewPoster } from "../../../core/ports/review-poster";
import {
  type PostedComment,
  buildReview,
  isCompleteRun,
  parseRecords,
} from "../../../core/posting/review-payload";
import { errorMessage } from "../../../core/util/errors";
import { type LogSettings } from "../../../providers/logging/log-settings";
import { PinoLogger } from "../../../providers/logging/pino-logger";
import { OperatorError } from "../../command-line";
import { REPOSITORIES } from "../../options/repository";

import { type CommentArguments } from "./command";

/**
 * Runs `comment`.
 *
 * @returns The exit code.
 * @throws {@link OperatorError} when the findings file cannot be read or the token variable is unset.
 */
export async function runComment(
  arguments_: CommentArguments,
  logging: LogSettings,
): Promise<number> {
  const logger = PinoLogger.console({ settings: logging });
  const log = logger.child("comment");

  let text: string;
  try {
    text = readFileSync(arguments_.findings, "utf8");
  } catch (error) {
    throw new OperatorError(`could not read ${arguments_.findings}: ${errorMessage(error)}`);
  }

  const records = parseRecords(text);
  if (records.unreadable > 0) {
    log.warn(`${String(records.unreadable)} line(s) of ${arguments_.findings} were not records.`);
  }
  // A run that did not finish, or could not review a file, is not a verdict: it is posted, so the pull
  // request says so, but it may not lift an earlier one.
  const isComplete = isCompleteRun(records);
  if (!isComplete) {
    log.warn(
      records.summary === null
        ? `${arguments_.findings} ends without a summary record: the review run did not finish. Posting what it holds as incomplete.`
        : `${String(records.summary.failed)} file(s) could not be reviewed. Posting the review as incomplete.`,
    );
  }
  const build = (posted: readonly PostedComment[]): ReturnType<typeof buildReview> =>
    buildReview(records, {
      maxInline: arguments_.maxInline,
      requestChangesOn: arguments_.requestChangesOn,
      posted,
    });
  const describe = (review: ReturnType<typeof buildReview>): string =>
    `${String(records.findings.length)} finding(s) read; ${String(review.comments.length)} inline, ${String(review.overflow)} in the body, ${String(review.alreadyPosted)} already posted; posting as ${review.event}.`;

  if (arguments_.dryRun) {
    // No token, so no host to ask: a dry run shows every finding as if the pull request were empty.
    const review = build([]);
    log.info(describe(review));
    process.stdout.write(`[${review.event}]\n${review.body}\n`);
    for (const comment of review.comments) {
      process.stdout.write(`\n--- ${comment.path}:${String(comment.line)}\n${comment.body}\n`);
    }
    return 0;
  }

  const repository = REPOSITORIES.get(arguments_.provider);
  const token = process.env[repository.tokenVariable] ?? "";
  if (token === "") {
    throw new OperatorError(`${repository.tokenVariable} is not set; it is what posts the review.`);
  }

  const poster: ReviewPoster = REPOSITORIES.create(repository.name, {
    token,
    baseUrl: arguments_.baseUrl,
    identity: arguments_.identity,
    logger,
  });
  const target = { repository: arguments_.repo, pullNumber: arguments_.pr };
  const posted = arguments_.allowDuplicates ? [] : await poster.postedComments(target);
  if (posted.length > 0) {
    log.info(`${String(posted.length)} inline comment(s) from earlier automated reviews found.`);
  }
  const review = build(posted);
  log.info(describe(review));
  // An incremental run reviewed only the commits since one point: a clean result does not mean an
  // earlier verdict was answered, so it must not lift one.
  const isIncremental = records.summary?.incremental === true;
  if (isIncremental && arguments_.supersede) {
    log.info(
      "The run reviewed only the commits since a checkpoint; earlier reviews are left standing rather than superseded.",
    );
  }
  if (!isComplete && arguments_.supersede) {
    log.info("The run is incomplete; earlier reviews are left standing rather than superseded.");
  }
  const { inline, superseded } = await poster.submit({
    repository: arguments_.repo,
    pullNumber: arguments_.pr,
    body: review.body,
    comments: review.comments,
    event: review.event,
    supersede: isComplete && !isIncremental && arguments_.supersede,
  });
  const dismissed = superseded > 0 ? `; dismissed ${String(superseded)} earlier review(s)` : "";
  log.info(
    `Posted one ${review.event} review with ${String(inline)} inline comment(s)${dismissed}.`,
  );
  return 0;
}
