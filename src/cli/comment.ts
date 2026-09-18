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

import { type Command, InvalidArgumentError } from "commander";

import { MAX_INLINE, buildReview, parseRecords } from "../core/posting/review-payload";
import { PostingError } from "../core/posting/review-poster";
import { errorMessage } from "../core/util/errors";
import { PinoLogger } from "../infra/logging/pino-logger";
import { builtinReviewPosterRegistry } from "../infra/posters/index";

import { OperatorError, commandLine, parseCommandLine, runCommand, severityList } from "./program";

// The shared scaffolding owns these; re-exported so a caller of this module
// need not know where a usage error is defined.

/**
 * The hosting systems `--provider` may name.
 *
 * Built once, at module scope: `--provider` is validated at parse time, before
 * any poster exists, and it must be validated against the same registry the
 * poster is later built through.
 */
const posters = builtinReviewPosterRegistry();
const DEFAULT_PROVIDER = posters.names()[0] ?? "github";

/** The parsed command line. */
export interface CommentArguments {
  readonly findings: string;
  /** Which hosting system posts; a name the registry knows. */
  readonly provider: string;
  readonly repo: string;
  readonly pr: number;
  readonly maxInline: number;
  /** Severities that make the review a request for changes; empty means never. */
  readonly requestChangesOn: readonly string[];
  /** Dismiss this identity's earlier pending reviews before posting. */
  readonly supersede: boolean;
  readonly baseUrl: string | null;
  /** Print the review instead of posting it; needs no token. */
  readonly dryRun: boolean;
  readonly verbose: boolean;
}

function integer(value: string): number {
  if (!/^\d+$/u.test(value)) throw new InvalidArgumentError("Not a positive integer.");
  return Number(value);
}

/** The command line as a `Command`; exposed so `--help` can be tested. */
export function buildProgram(): Command {
  return commandLine(
    "review-comment",
    "Post the findings of a review run to a pull request, reading the NDJSON that " +
      "`reviewer --out` writes. Calls no language model: this is the half of the split that " +
      "holds a repository token.",
  )
    .requiredOption("--findings <path>", "The NDJSON record stream to post.")
    .option(
      "--provider <name>",
      `The hosting system to post to: ${posters.describe()}. Its token is read from the variable the provider names (see --help of each).`,
      (value: string) => {
        if (!posters.has(value)) {
          throw new InvalidArgumentError(`Allowed providers are ${posters.names().join(", ")}.`);
        }
        return value;
      },
      DEFAULT_PROVIDER,
    )
    .requiredOption(
      "--repo <slug>",
      "The repository the change request belongs to, as the provider names it (GitHub: owner/name).",
    )
    .requiredOption("--pr <number>", "The pull request number.", integer)
    .option(
      "--max-inline <n>",
      `Cap on inline comments; the rest are listed in the review body (default ${String(MAX_INLINE)}).`,
      integer,
      MAX_INLINE,
    )
    .option(
      "--request-changes-on <severities>",
      "Post as a request for changes when a finding has one of these severities (comma-separated, or none). Default none: comment only.",
      severityList,
      [] as string[],
    )
    .option(
      "--supersede",
      "Dismiss this identity's earlier pending reviews on the pull request first, so it shows one current verdict. A clean run then lifts an earlier block.",
      false,
    )
    .option(
      "--base-url <url>",
      "API root, for a self-hosted instance (default: the provider's public endpoint).",
    )
    .option("--dry-run", "Print the review that would be posted and stop. Needs no token.", false)
    .option("-v, --verbose", "DEBUG logging on stderr.", false);
}

/** Parse `argv` (without the executable and script) into typed arguments. */
export function parseArguments(argv: readonly string[]): CommentArguments {
  const program = buildProgram();
  parseCommandLine(program, argv);
  const options = program.opts<{
    findings: string;
    provider: string;
    repo: string;
    pr: number;
    maxInline: number;
    requestChangesOn: string[];
    supersede: boolean;
    baseUrl?: string;
    dryRun: boolean;
    verbose: boolean;
  }>();
  return {
    findings: options.findings,
    provider: options.provider,
    repo: options.repo,
    pr: options.pr,
    maxInline: options.maxInline,
    requestChangesOn: options.requestChangesOn,
    supersede: options.supersede,
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
export function main(argv: readonly string[]): Promise<number> {
  return runCommand(() => post(parseArguments(argv)), {
    // A refusal from the hosting system (a wrong slug, a token without write
    // permission) is the operator's to act on, whichever system it was.
    isOperatorError: (error) => error instanceof PostingError,
  });
}

async function post(arguments_: CommentArguments): Promise<number> {
  const logger = PinoLogger.console({ verbose: arguments_.verbose });
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

  // The provider says which variable holds its token, so a GitLab workflow
  // sets GITLAB_TOKEN and nothing here has to know.
  const provider = posters.get(arguments_.provider);
  const token = process.env[provider.tokenVariable] ?? "";
  if (token === "") {
    throw new OperatorError(`${provider.tokenVariable} is not set; it is what posts the review.`);
  }

  const poster = posters.create(provider.name, { token, baseUrl: arguments_.baseUrl });
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

export { UsageError } from "./program";
