/**
 * `reviewer comment`: its flags and their parsed shape. The only command that holds a repository token;
 * it builds no model and reads a plain NDJSON file.
 * @packageDocumentation
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

/** The parsed `comment` command line. */
export interface CommentArguments {
  readonly findings: string;
  /** The hosting system; a name the registry knows. */
  readonly provider: string;
  readonly repo: string;
  readonly pr: number;
  readonly maxInline: number;
  /** Severities that make the review a request for changes; empty means never. */
  readonly requestChangesOn: readonly Severity[];
  /** Dismiss this identity's earlier pending reviews first. */
  readonly supersede: boolean;
  /** Post every finding inline, even where an earlier automated review already commented on its lines. */
  readonly allowDuplicates: boolean;
  readonly baseUrl: string | null;
  /** The account the token posts as; `null` takes the provider's default for its CI token. */
  readonly identity: string | null;
  /** Print the review instead of posting it; needs no token. */
  readonly dryRun: boolean;
}

/** `comment`'s options plus the root's logging flags. */
export type CommentOptions = ParsedOptions<CommentArguments> & ParsedOptions<LoggingArguments>;

/** The `comment` flags. */
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
      "--allow-duplicates",
      "Post every finding inline even where an earlier automated review already commented on the same lines. By default such findings are counted in the body and not repeated.",
      false,
    )
    .option(
      "--base-url <url>",
      "API root, for a self-hosted instance (default: the provider's public endpoint).",
    )
    .option(
      "--identity <login>",
      "The account the token posts as, so --supersede dismisses and the duplicate check counts only its own reviews (GitHub default: github-actions[bot], what GITHUB_TOKEN posts as; set it for a PAT or an App token).",
    )
    .option("--dry-run", "Print the review that would be posted and stop. Needs no token.", false);
}

/** A hosting system's refusal is the operator's to act on. */
const isCommentOperatorError = instanceOfAny(PostingError);

/** `reviewer comment`, as the root registers it. Builds no container, so it carries its own settled logging. */
export const COMMENT = defineCommand<CommentArguments & { logging: LogSettings }, CommentOptions>({
  name: "comment",
  description:
    "Post the findings of a review run to a pull request, reading the NDJSON that " +
    "`reviewer review --out` writes. Calls no language model: this is the half of the split that " +
    "holds a repository token.",
  options: commentOptions,
  arguments: (options) => ({
    ...options,
    baseUrl: options.baseUrl ?? null,
    identity: options.identity ?? null,
    logging: logSettingsFrom(loggingArguments(options)),
  }),
  run: ({ logging, ...rest }) => runComment(rest, logging),
  isOperatorError: isCommentOperatorError,
});
