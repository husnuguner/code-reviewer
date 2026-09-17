/**
 * `review-comment`: post a run's findings to a pull request.
 *
 * A second executable, not a flag on `reviewer`, and that separation is the
 * whole design. This one holds a repository token and cannot call a model;
 * `reviewer` calls a model and cannot post. Neither can be talked into the
 * other's job, which is what makes a prompt-injected diff harmless here
 * (see README, "Why the reviewer cannot post").
 *
 * Its input is the NDJSON `reviewer --out` writes, so it is equally usable
 * from a workflow, a cron job, or by hand against a file on disk.
 */

import { readFileSync } from "node:fs";

import { Command, CommanderError, InvalidArgumentError } from "commander";

import { MAX_INLINE, buildReview, parseRecords } from "../core/comment/review-payload";
import { errorMessage } from "../core/util/errors";
// eslint-disable-next-line unicorn/name-replacements -- `Repository` is the domain term (CONTEXT.md), not an abbreviation
import { GithubError, GithubReviewClient, parseRepository } from "../infra/github/review-client";
import { PinoLogger } from "../infra/logging/pino-logger";

/** The parsed command line. */
export interface CommentArguments {
  readonly findings: string;
  readonly repo: string;
  readonly pr: number;
  readonly maxInline: number;
  readonly baseUrl: string | null;
  /** Print the review instead of posting it; needs no token. */
  readonly dryRun: boolean;
  readonly verbose: boolean;
}

/** A usage error, surfaced as a message and an exit code. */
export class UsageError extends Error {
  override readonly name = "UsageError";

  constructor(
    message: string,
    readonly exitCode: number,
  ) {
    super(message);
  }
}

function integer(value: string): number {
  if (!/^\d+$/u.test(value)) throw new InvalidArgumentError("Not a positive integer.");
  return Number(value);
}

/** The command line as a `Command`; exposed so `--help` can be tested. */
export function buildProgram(): Command {
  return new Command("review-comment")
    .description(
      "Post the findings of a review run to a pull request, reading the NDJSON that " +
        "`reviewer --out` writes. Calls no language model: this is the half of the split that " +
        "holds a repository token.",
    )
    .requiredOption("--findings <path>", "The NDJSON record stream to post.")
    .requiredOption("--repo <owner/name>", "The repository the pull request belongs to.")
    .requiredOption("--pr <number>", "The pull request number.", integer)
    .option(
      "--max-inline <n>",
      `Cap on inline comments; the rest are listed in the review body (default ${String(MAX_INLINE)}).`,
      integer,
      MAX_INLINE,
    )
    .option("--base-url <url>", "REST root, for GitHub Enterprise (default api.github.com).")
    .option("--dry-run", "Print the review that would be posted and stop. Needs no token.", false)
    .option("-v, --verbose", "DEBUG logging on stderr.", false)
    .allowExcessArguments(false)
    .exitOverride()
    .configureOutput({ writeErr: (text) => process.stderr.write(text) });
}

/** Parse `argv` (without the executable and script) into typed arguments. */
export function parseArguments(argv: readonly string[]): CommentArguments {
  const program = buildProgram();
  try {
    program.parse([...argv], { from: "user" });
  } catch (error) {
    if (error instanceof CommanderError) throw new UsageError(error.message, error.exitCode);
    throw error;
  }
  const options = program.opts<{
    findings: string;
    repo: string;
    pr: number;
    maxInline: number;
    baseUrl?: string;
    dryRun: boolean;
    verbose: boolean;
  }>();
  return {
    findings: options.findings,
    repo: options.repo,
    pr: options.pr,
    maxInline: options.maxInline,
    baseUrl: options.baseUrl ?? null,
    dryRun: options.dryRun,
    verbose: options.verbose,
  };
}

/**
 * The process entry: read the records, build the review, post it.
 *
 * A stream with no findings is still posted. "I looked and found nothing" is
 * information a reviewer wants, and silence is indistinguishable from a run
 * that never happened.
 */
export async function main(argv: readonly string[]): Promise<number> {
  let arguments_: CommentArguments;
  try {
    arguments_ = parseArguments(argv);
  } catch (error) {
    if (error instanceof UsageError) {
      if (error.exitCode !== 0) process.stderr.write(`${error.message}\n`);
      return error.exitCode;
    }
    throw error;
  }

  const logger = PinoLogger.console({ verbose: arguments_.verbose });
  const log = logger.child("comment");

  let text: string;
  try {
    text = readFileSync(arguments_.findings, "utf8");
  } catch (error) {
    process.stderr.write(`error: could not read ${arguments_.findings}: ${errorMessage(error)}\n`);
    return 2;
  }

  const records = parseRecords(text);
  const review = buildReview(records, { maxInline: arguments_.maxInline });
  log.info(
    `${String(records.findings.length)} finding(s) read; ${String(review.comments.length)} inline, ${String(review.overflow)} in the body.`,
  );
  if (records.unreadable > 0) {
    log.warn(`${String(records.unreadable)} line(s) of ${arguments_.findings} were not records.`);
  }

  if (arguments_.dryRun) {
    process.stdout.write(`${review.body}\n`);
    for (const comment of review.comments) {
      process.stdout.write(`\n--- ${comment.path}:${String(comment.line)}\n${comment.body}\n`);
    }
    return 0;
  }

  const token = process.env["GITHUB_TOKEN"] ?? "";
  if (token === "") {
    process.stderr.write("error: GITHUB_TOKEN is not set; it is what posts the review.\n");
    return 2;
  }

  try {
    const client = new GithubReviewClient({
      token,
      ...(arguments_.baseUrl !== null && { baseUrl: arguments_.baseUrl }),
      logger,
    });
    const { inline } = await client.submit({
      repository: parseRepository(arguments_.repo),
      pullNumber: arguments_.pr,
      body: review.body,
      comments: review.comments,
    });
    log.info(`Posted one review with ${String(inline)} inline comment(s).`);
    return 0;
  } catch (error) {
    // A failure to post is the operator's to act on (a wrong slug, a token
    // without `pull-requests: write`), so it gets a message, not a stack.
    if (error instanceof GithubError) {
      process.stderr.write(`error: ${error.message}\n`);
      return 2;
    }
    throw error;
  }
}
