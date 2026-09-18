/**
 * `reviewer review`: what it does.
 *
 * Parsed arguments in, an exit code out. Builds the container from the
 * arguments, then either previews the selection (no model) or streams the
 * review through the reporter the format chose.
 */

import { type ConfigField } from "../../../core/config/config";
import {
  type BranchReviewResult,
  previewBranch,
  streamBranchReview,
} from "../../../core/review/branch-review";
import { severityGate } from "../../../core/review/severity";
import { GitCodeContext } from "../../../providers/git/git-code-context";
import { closeReporter } from "../../../providers/reporting/closable";
import { type RunCradle, type RunRequest, buildContainer } from "../../container";
import { logSettingsFrom } from "../../options/logging";

import { type ReviewArguments } from "./command";

/** Exit code for a run that found something `--fail-on` named. */
export const FINDINGS_EXIT_CODE = 3;

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

/** What the container needs to know, straight from the parsed arguments. */
function requestFrom(arguments_: ReviewArguments): RunRequest {
  return {
    project: arguments_.project,
    configFile: arguments_.config,
    logging: logSettingsFrom(arguments_),
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
export async function runReview(arguments_: ReviewArguments): Promise<number> {
  const { cradle } = buildContainer(requestFrom(arguments_));
  // A preview calls no model, so it is answered before anything resolves one.
  if (arguments_.preview) {
    await runPreview(arguments_, cradle);
    return 0;
  }
  const { config, logger } = cradle;
  logger
    .child("run")
    .debug(`LLM provider: ${config.provider} (model: ${config.model ?? "<provider default>"}).`);
  return runBranchReview(arguments_, cradle);
}
