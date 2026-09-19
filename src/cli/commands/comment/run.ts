/**
 * `reviewer comment`: reads the records, builds the review, posts it. A stream with no findings is
 * still posted.
 * @packageDocumentation
 */

import { readFileSync } from "node:fs";

import { type ReviewPoster } from "../../../core/ports/review-poster";
import { buildReview, parseRecords } from "../../../core/posting/review-payload";
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
  const review = buildReview(records, {
    maxInline: arguments_.maxInline,
    requestChangesOn: arguments_.requestChangesOn,
  });
  log.info(
    `${String(records.findings.length)} finding(s) read; ${String(review.comments.length)} inline, ${String(review.overflow)} in the body; posting as ${review.event}.`,
  );
  if (records.unreadable > 0) {
    log.warn(`${String(records.unreadable)} line(s) of ${arguments_.findings} were not records.`);
  }

  if (arguments_.dryRun) {
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
    logger,
  });
  const { inline, superseded } = await poster.submit({
    repository: arguments_.repo,
    pullNumber: arguments_.pr,
    body: review.body,
    comments: review.comments,
    event: review.event,
    supersede: arguments_.supersede,
  });
  const dismissed = superseded > 0 ? `; dismissed ${String(superseded)} earlier review(s)` : "";
  log.info(
    `Posted one ${review.event} review with ${String(inline)} inline comment(s)${dismissed}.`,
  );
  return 0;
}
