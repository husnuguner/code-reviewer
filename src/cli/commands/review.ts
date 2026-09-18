/**
 * `reviewer review` (the default): compare a branch against a base from local
 * git, review what changed, and report it.
 *
 * Nothing is posted and no hosting credential is read -- turning a finding
 * into a pull-request comment is `reviewer comment`'s job, downstream of the
 * NDJSON this prints. Parsing is separated from running so the flags can be
 * tested without a container.
 */

import { type Command, Option } from "commander";

import { type ConfigField, ConfigError } from "../../core/config/config";
import {
  type BranchReviewResult,
  previewBranch,
  streamBranchReview,
} from "../../core/review/branch-review";
import { type Severity, severityGate } from "../../core/review/severity";
import { CatalogError, GitError, ReportFileError } from "../../core/util/errors";
import { GitCodeContext } from "../../infra/git/git-code-context";
import { closeReporter } from "../../infra/reporters/stdout";
import { choice, defineCommand, instanceOfAny, repeatable, text } from "../command-line";
import { type ReportFormat, type RunCradle, type RunRequest, buildContainer } from "../container";

import {
  type CatalogArguments,
  DEFAULT_FORMAT,
  REPORT_FORMATS,
  catalogArguments,
  catalogOptions,
  severityList,
} from "./shared";

/**
 * The ref reviewed when `--branch` is not given.
 *
 * `HEAD` rather than a branch name because that is what a CI checkout has:
 * a pull-request build sits on a detached commit, and a flag that insisted on
 * a branch name would make the common case the awkward one.
 */
export const DEFAULT_BRANCH = "HEAD";

/** Exit code for a run that found something `--fail-on` named. */
export const FINDINGS_EXIT_CODE = 3;

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
      // here (see infra/reporters/index.ts).
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
 * The settings the command line states, which outrank every other layer.
 *
 * Only what was actually passed: an argument left at its default must not
 * shadow a project or environment value with it.
 */
export function cliOverrides(arguments_: ReviewArguments): Partial<Record<ConfigField, unknown>> {
  return {
    ...(arguments_.lang !== null && arguments_.lang !== "" && { reviewLang: arguments_.lang }),
    ...(arguments_.skillsPath !== null && { skillsPath: arguments_.skillsPath }),
    // Only the refusal is a command-line statement: there is no `--verify`,
    // so a run that did not say no leaves the question to the layers below.
    ...(!arguments_.verify && { verifyFindings: false }),
  };
}

/**
 * Whether the run found something `--fail-on` named.
 *
 * Asked of the reported findings, not of everything the model said: a finding
 * verification refuted or the volume policy withheld is not a reason to fail
 * a build the reviewer never showed it to.
 *
 * The comparison goes through `severityGate` rather than being spelled here,
 * so this gate and `--request-changes-on`'s cannot drift in how they read a
 * severity -- which is exactly how they drifted before.
 */
export function hasFailingFinding(
  result: Pick<BranchReviewResult, "findings">,
  severities: readonly string[],
): boolean {
  const isGated = severityGate(severities);
  return result.findings.some((finding) => isGated(finding.severity));
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

/** What the container needs to know, straight from the parsed arguments. */
function requestFrom(arguments_: ReviewArguments): RunRequest {
  return {
    project: arguments_.project,
    configFile: arguments_.config,
    verbose: arguments_.verbose,
    overrides: cliOverrides(arguments_),
    // A preview calls no model, so it must not be stopped by a credential it
    // will never send.
    requiresModel: !arguments_.preview,
    format: arguments_.format,
    outFile: arguments_.out,
  };
}

/** Branch review: local git in, a reporter out. */
async function runBranchReview(arguments_: ReviewArguments, cradle: RunCradle): Promise<number> {
  const { config, logger, checkoutRoot, gitReader } = cradle;
  // Resolved first, before anything expensive: the container is lazy, so this
  // line is where `--out` actually opens its file. A path the filesystem
  // refuses must cost nothing, and after the first model call it would cost
  // the whole run.
  const reporter = cradle.branchReporter;
  const options = {
    base: arguments_.base,
    branch: arguments_.branch,
    reviewer: cradle.fileReviewer,
    verifier: cradle.verifier,
    git: gitReader,
    settings: config.fileReviewSettings(arguments_.exclude),
    skills: await cradle.skills,
    maxConcurrentFiles: config.concurrency().files,
    maxFindingsPerFile: config.reportPolicy().maxFindingsPerFile,
    // The one collaborator built here rather than in the container: it is
    // bound to the branch under review, which only the arguments know.
    codeContext: new GitCodeContext(checkoutRoot, arguments_.branch, undefined, logger),
    logger,
  };

  // Every run streams through the reporter, whatever the format: rendering is
  // the format's business, not this function's. That is also what makes
  // `--out` orthogonal, so a human-readable run still leaves behind the
  // machine-readable copy `reviewer comment` reads.
  let result: BranchReviewResult;
  try {
    result = await streamBranchReview(options, reporter);
  } finally {
    // The record file is handed back here rather than left to process exit: a
    // line still in its buffer is a line the poster downstream never reads,
    // and a write that failed late is only knowable once the last one has
    // been flushed.
    await closeReporter(reporter);
  }
  return hasFailingFinding(result, arguments_.failOn) ? FINDINGS_EXIT_CODE : 0;
}

/**
 * `--preview`: what would be reviewed, and nothing else.
 *
 * Kept off the review path on purpose. It never touches `cradle.fileReviewer`
 * or `cradle.verifier`, so the container never builds a language model and a
 * preview runs on a machine that has no LLM credential at all -- which is the
 * whole point of a free pre-flight.
 */
async function runPreview(arguments_: ReviewArguments, cradle: RunCradle): Promise<void> {
  const { config, logger, gitReader } = cradle;
  const { report } = await previewBranch({
    base: arguments_.base,
    branch: arguments_.branch,
    git: gitReader,
    settings: config.fileReviewSettings(arguments_.exclude),
    logger,
  });
  cradle.console.line(report);
}

/** Run one review (or its preview) from parsed arguments; returns the exit code. */
async function runReview(arguments_: ReviewArguments): Promise<number> {
  const { cradle } = buildContainer(requestFrom(arguments_));
  // A preview calls no model, so it is answered before anything resolves one.
  if (arguments_.preview) {
    await runPreview(arguments_, cradle);
    return 0;
  }
  const { config, logger } = cradle;
  logger
    .child("run")
    .debug(
      `LLM provider: ${config.provider} (model: ${config.modelName ?? "<provider default>"}).`,
    );
  return runBranchReview(arguments_, cradle);
}

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
