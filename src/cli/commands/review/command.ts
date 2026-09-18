/**
 * `reviewer review` (the default): what it takes.
 *
 * The flags, the shape they parse into, and the command's registration. What
 * the command *does* with them is `run.ts`, so the flags can be tested
 * without a container and the flow without Commander.
 *
 * Nothing is posted and no hosting credential is read -- turning a finding
 * into a pull-request comment is `reviewer comment`'s job, downstream of the
 * NDJSON this prints.
 */

import { type Command, Option } from "commander";

import { ConfigError } from "../../../core/config/config";
import { type Severity } from "../../../core/review/severity";
import { CatalogError, GitError, ReportFileError } from "../../../core/util/errors";
import { choice, defineCommand, instanceOfAny, repeatable, text } from "../../command-line";
import { type ReportFormat } from "../../container";
import { type CatalogArguments, catalogArguments, catalogOptions } from "../../options/catalog";
import { DEFAULT_FORMAT, REPORT_FORMATS } from "../../options/format";
import { severityList } from "../../options/severity";

import { runReview } from "./run";

/**
 * What `--branch` means when it is not given: the checkout as it is.
 *
 * `HEAD` rather than a branch name, because the common CI case is a detached
 * commit: a pull-request build sits on a detached commit, and a flag that
 * insisted on a branch name would make the common case the awkward one.
 */
export const DEFAULT_BRANCH = "HEAD";

/** The parsed `review` command line, one field per flag. */
export interface ReviewArguments extends CatalogArguments {
  readonly project: string | null;
  readonly branch: string;
  readonly base: string;
  readonly format: ReportFormat;
  /** Where a machine-readable copy of the records also goes, or `null`. */
  readonly out: string | null;
  /** Print what would be reviewed and stop, calling no model. */
  readonly preview: boolean;
  readonly lang: string | null;
  readonly skillsPath: string | null;
  readonly exclude: readonly string[];
  /** Severities that make the run exit non-zero; empty never fails. */
  readonly failOn: readonly Severity[];
  /** False only when `--no-verify` was passed; otherwise the config decides. */
  readonly verify: boolean;
}

/** The `review` subcommand's flags, on top of the catalogue's. */
function reviewOptions(command: Command): Command {
  return (
    catalogOptions(command)
      .option(
        "--project <name>",
        "Name of the project to review, as defined in config.yaml. Optional when the config defines exactly one, or when there is no config and the environment describes the target.",
      )
      .option(
        "--branch <name>",
        "Branch or commit to review against --base; unset, the current checkout.",
        DEFAULT_BRANCH,
      )
      .option("--base <name>", "Base branch to compare against.", "main")
      // Both the accepted values and the help text come from the registry, so a
      // newly registered format is selectable and documented without an edit
      // here (see providers/reporting/builtin.ts).
      .option(
        "--format <format>",
        `How findings are reported: ${REPORT_FORMATS.describe()}. Logs always stay on stderr.`,
        choice(REPORT_FORMATS.names(), { label: "formats" }),
        DEFAULT_FORMAT,
      )
      .option(
        "--out <path>",
        "Also write every record to this file as NDJSON, whatever --format prints. This is what `reviewer comment` reads.",
      )
      .option(
        "--preview",
        "Print which files would be reviewed and why each of the others was skipped, then stop. No model is called, so this costs nothing and needs no LLM credential. Output is always text.",
        false,
      )
      .option(
        "--lang <lang>",
        "Language for the findings, e.g. 'tr' or 'en' (default: the project's setting, else REVIEW_LANG, else English).",
      )
      .option(
        "--skills-path <path>",
        "Directory of review skills inside the reviewed repository (overrides the project's skills_path). Empty disables skills.",
      )
      // `Option` rather than `.option()` where the default is a list: Commander
      // would print it as `[]`, and "none" is what the flag actually takes.
      .addOption(
        new Option(
          "--exclude <glob>",
          "Glob of files to skip entirely (repeatable); adds to the project's exclude list. E.g. --exclude '**/*.md'.",
        )
          .argParser(repeatable(text))
          .default([], "none"),
      )
      .addOption(
        new Option(
          "--fail-on <severities>",
          "Exit 3 when a surviving finding has one of these severities, e.g. 'bug,security'; 'none' disables. Reporting is unaffected: this only decides the exit code.",
        )
          .argParser(severityList)
          .default([], "none"),
      )
      .option(
        "--no-verify",
        "Report every finding the model produced, skipping the verification pass that removes the ones the diff refutes (one extra model call per file that found something).",
      )
  );
}

/**
 * Which of a review's failures are the operator's to fix.
 *
 * Configuration and working-tree problems are theirs, so they get one plain
 * `error:` line rather than a stack trace pointing into our code. An `--out`
 * path the filesystem refuses is the same kind of problem, which is why
 * `ReportFileError` is named here alongside the rest.
 */
const isReviewOperatorError = instanceOfAny(CatalogError, GitError, ConfigError, ReportFileError);

/** `reviewer review`, as the root command registers it. */
export const REVIEW = defineCommand<ReviewArguments>({
  name: "review",
  description:
    "Review a branch against a base from local git and report the findings " +
    "(bug/security/performance/readability). The default command. Nothing is posted: " +
    "the findings go to stdout as text, NDJSON or GitHub Actions annotations, and " +
    "`reviewer comment` reads them from there.",
  options: reviewOptions,
  // Only the strings that may be absent need a word: Commander says `undefined`, the run says `null`.
  arguments: (options) => ({
    ...options,
    ...catalogArguments(options),
    project: options.project ?? null,
    out: options.out ?? null,
    lang: options.lang ?? null,
    skillsPath: options.skillsPath ?? null,
  }),
  run: runReview,
  isOperatorError: isReviewOperatorError,
});
