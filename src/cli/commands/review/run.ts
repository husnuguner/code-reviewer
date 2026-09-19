/**
 * `reviewer review`: builds the container, then previews the selection (no model) or streams the review
 * through the chosen reporter.
 * @packageDocumentation
 */

import { type ConfigField } from "../../../core/config/config";
import {
  type BranchReviewResult,
  WORKTREE_BASE,
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
 * The settings the command line states; only what was actually passed, so a default cannot shadow a
 * project or environment value.
 */
export function cliOverrides(arguments_: ReviewArguments): Partial<Record<ConfigField, unknown>> {
  return {
    ...(arguments_.lang !== null && arguments_.lang !== "" && { reviewLang: arguments_.lang }),
    ...(arguments_.skillsPath !== null && { skillsPath: arguments_.skillsPath }),
    // Only the refusal is a statement: there is no `--verify`.
    ...(!arguments_.verify && { verifyFindings: false }),
  };
}

/**
 * Whether a reported finding has one of the gated severities.
 *
 * @remarks Asked of reported findings only; goes through `severityGate` so this and `--request-changes-on` cannot drift.
 */
export function hasFailingFinding(
  result: Pick<BranchReviewResult, "findings">,
  severities: readonly string[],
): boolean {
  const isGated = severityGate(severities);
  return result.findings.some((finding) => isGated(finding.severity));
}

/** The ref pre-context is read at: `HEAD` for an uncommitted review, else `--branch`. */
function contextReference(arguments_: ReviewArguments): string {
  return arguments_.uncommitted ? WORKTREE_BASE : arguments_.branch;
}

/** The container request from the parsed arguments; a preview needs no model. */
function requestFrom(arguments_: ReviewArguments): RunRequest {
  return {
    project: arguments_.project,
    configFile: arguments_.config,
    logging: logSettingsFrom(arguments_),
    overrides: cliOverrides(arguments_),
    requiresModel: !arguments_.preview,
    format: arguments_.format,
    outFile: arguments_.out,
  };
}

/**
 * Streams the review through the reporter and returns the exit code.
 *
 * @remarks The reporter is resolved first, so a bad `--out` path fails before any model call; it is closed
 * in `finally` so no record is left in a buffer.
 */
async function runBranchReview(arguments_: ReviewArguments, cradle: RunCradle): Promise<number> {
  const { config, logger, checkoutRoot, gitReader } = cradle;
  const reporter = cradle.branchReporter;
  const options = {
    base: arguments_.base,
    branch: arguments_.branch,
    uncommitted: arguments_.uncommitted,
    reviewer: cradle.fileReviewer,
    verifier: cradle.verifier,
    git: gitReader,
    settings: config.fileReviewSettings(arguments_.exclude),
    skills: await cradle.skills,
    maxConcurrentFiles: config.concurrency().files,
    maxFindingsPerFile: config.reportPolicy().maxFindingsPerFile,
    // Built here rather than in the container: bound to the ref only the arguments know.
    codeContext: new GitCodeContext(checkoutRoot, contextReference(arguments_), undefined, logger),
    logger,
  };

  let result: BranchReviewResult;
  try {
    result = await streamBranchReview(options, reporter);
  } finally {
    await closeReporter(reporter);
  }
  return hasFailingFinding(result, arguments_.failOn) ? FINDINGS_EXIT_CODE : 0;
}

/** `--preview`: prints the selection. Never touches the model or the verifier, so no credential is needed. */
async function runPreview(arguments_: ReviewArguments, cradle: RunCradle): Promise<void> {
  const { config, logger, gitReader } = cradle;
  const { report } = await previewBranch({
    base: arguments_.base,
    branch: arguments_.branch,
    uncommitted: arguments_.uncommitted,
    git: gitReader,
    settings: config.fileReviewSettings(arguments_.exclude),
    logger,
  });
  cradle.console.line(report);
}

/**
 * Runs `review` (or its preview).
 *
 * @returns The exit code.
 */
export async function runReview(arguments_: ReviewArguments): Promise<number> {
  const { cradle } = buildContainer(requestFrom(arguments_));
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
