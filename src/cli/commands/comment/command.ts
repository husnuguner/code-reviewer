/**
 * `reviewer comment`: what it takes.
 *
 * The other half of the split, and the only half that holds a repository
 * token. It never builds a model: its input is the NDJSON `reviewer --out`
 * wrote, a plain data file, so nothing a diff says can reach it -- and the
 * review that read the diff never had a token to post with. One executable,
 * two commands, no run that holds both credentials (see README, "Why the
 * reviewer cannot post").
 */

import { type Command, Option } from "commander";

import { PostingError } from "../../../core/ports/review-poster";
import { MAX_INLINE } from "../../../core/posting/review-payload";
import { type Severity } from "../../../core/review/severity";
import { type LogSettings } from "../../../providers/logging/log-settings";
import {
  type ParsedOptions,
  choice,
  defineCommand,
  instanceOfAny,
  integer,
} from "../../command-line";
import { type LoggingArguments, logSettingsFrom, loggingArguments } from "../../options/logging";
import { DEFAULT_REPOSITORY, REPOSITORIES } from "../../options/repository";
import { severityList } from "../../options/severity";

import { runComment } from "./run";

/** The parsed `comment` command line, one field per flag. */
export interface CommentArguments {
  readonly findings: string;
  /** Which hosting system posts; a name the registry knows. */
  readonly provider: string;
  readonly repo: string;
  readonly pr: number;
  readonly maxInline: number;
  /** Severities that make the review a request for changes; empty means never. */
  readonly requestChangesOn: readonly Severity[];
  /** Dismiss this identity's earlier pending reviews before posting. */
  readonly supersede: boolean;
  readonly baseUrl: string | null;
  /** Print the review instead of posting it; needs no token. */
  readonly dryRun: boolean;
}

/** `comment` takes the root's logging flags like every other command. */
export type CommentOptions = ParsedOptions<CommentArguments> & ParsedOptions<LoggingArguments>;

/** The `comment` subcommand's flags. */
function commentOptions(command: Command): Command {
  return command
    .requiredOption("--findings <path>", "The NDJSON record stream to post.")
    .option(
      "--provider <name>",
      `The hosting system to post to: ${REPOSITORIES.describe()}. Its token is read from the variable the host names (see --help of each).`,
      choice(REPOSITORIES.names(), { label: "providers" }),
      DEFAULT_REPOSITORY,
    )
    .requiredOption(
      "--repo <slug>",
      "The repository the change request belongs to, as the provider names it (GitHub: owner/name).",
    )
    .requiredOption("--pr <number>", "The pull request number.", integer)
    .option(
      "--max-inline <n>",
      "Cap on inline comments; the rest are listed in the review body.",
      integer,
      MAX_INLINE,
    )
    .addOption(
      new Option(
        "--request-changes-on <severities>",
        "Post as a request for changes when a finding has one of these severities (comma-separated); 'none' only comments.",
      )
        .argParser(severityList)
        .default([], "none"),
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
    .option("--dry-run", "Print the review that would be posted and stop. Needs no token.", false);
}

/**
 * A refusal from the hosting system (a wrong slug, a token without write
 * permission) is the operator's to act on, whichever system it was.
 */
const isCommentOperatorError = instanceOfAny(PostingError);

/**
 * `reviewer comment`, as the root command registers it.
 *
 * The logging flags are read off the globals and settled at the parse, then
 * carried alongside the command's own arguments -- `comment` builds no
 * container, so it is the one command that has to hold its own logger.
 */
export const COMMENT = defineCommand<CommentArguments & { logging: LogSettings }, CommentOptions>({
  name: "comment",
  description:
    "Post the findings of a review run to a pull request, reading the NDJSON that " +
    "`reviewer --out` writes. Calls no language model: this is the half of the split that " +
    "holds a repository token.",
  options: commentOptions,
  arguments: (options) => ({
    ...options,
    baseUrl: options.baseUrl ?? null,
    logging: logSettingsFrom(loggingArguments(options)),
  }),
  run: ({ logging, ...rest }) => runComment(rest, logging),
  isOperatorError: isCommentOperatorError,
});
