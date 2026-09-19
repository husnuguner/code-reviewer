/**
 * `reviewer review` (the default): its flags and their parsed shape. What it does is `run.ts`.
 * @packageDocumentation
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

/** What `--branch` means when not given: `HEAD`, since a CI build sits on a detached commit. */
export const DEFAULT_BRANCH = "HEAD";

/** The parsed `review` command line. */
export interface ReviewArguments extends CatalogArguments {
  readonly project: string | null;
  readonly branch: string;
  readonly base: string;
  /** Review the working tree; `--branch` and `--base` are then not used. */
  readonly uncommitted: boolean;
  readonly format: ReportFormat;
  /** `--out`, or `null`. */
  readonly out: string | null;
  /** Print what would be reviewed and stop. */
  readonly preview: boolean;
  readonly lang: string | null;
  readonly skillsPath: string | null;
  readonly exclude: readonly string[];
  /** Severities that make the run exit `3`; empty never fails. */
  readonly failOn: readonly Severity[];
  /** `false` only when `--no-verify` was passed. */
  readonly verify: boolean;
}

/** The `review` flags, on top of the catalogue's. */
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
      .option(
        "--uncommitted",
        "Review the working tree against HEAD instead of a branch: staged and unstaged changes to tracked files, plus untracked files git is not ignoring. --base and --branch are not used.",
        false,
      )
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
      // `Option` where the default is a list, so help prints "none" rather than `[]`.
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

/** Configuration, working-tree and `--out` problems: one `error:` line, exit 2. */
const isReviewOperatorError = instanceOfAny(CatalogError, GitError, ConfigError, ReportFileError);

/** `reviewer review`, as the root registers it. */
export const REVIEW = defineCommand<ReviewArguments>({
  name: "review",
  description:
    "Review a branch against a base from local git and report the findings " +
    "(bug/security/performance/readability). The default command. Nothing is posted: " +
    "the findings go to stdout as text, NDJSON or GitHub Actions annotations, and " +
    "`reviewer comment` reads them from there.",
  options: reviewOptions,
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
