/**
 * `reviewer review`: builds the container, then previews the selection (no model) or streams the review
 * through the chosen reporter.
 * @packageDocumentation
 */

import { type ConfigField } from "../../../core/config/config";
import { type GitReader } from "../../../core/ports/git-reader";
import { type Logger } from "../../../core/ports/logger";
import {
  type BranchReviewResult,
  HEAD,
  previewBranch,
  streamBranchReview,
} from "../../../core/review/branch-review";
import { severityGate } from "../../../core/review/severity";
import { closeReporter } from "../../../providers/reporting/closable";
import { OperatorError } from "../../command-line";
import { type RunCradle, type RunRequest, buildContainer } from "../../container";
import { logSettingsFrom } from "../../options/logging";

import { type ReviewArguments } from "./command";

/** Exit code for a run that found something `--fail-on` named. */
export const FINDINGS_EXIT_CODE = 3;

/**
 * Exit code for a run that could not review every file it selected. It outranks {@link FINDINGS_EXIT_CODE}:
 * an incomplete review is not a verdict, whatever it did find.
 */
export const INCOMPLETE_EXIT_CODE = 4;

/**
 * The exit code a finished run earns.
 *
 * @param isIncompleteAllowed - `--allow-incomplete`: an unreviewed file does not decide the code.
 * @returns `4` when a selected file could not be reviewed (unless allowed), `3` when a reported finding is
 * gated, else `0`.
 */
export function exitCodeFor(
  result: Pick<BranchReviewResult, "findings" | "failed">,
  failOn: readonly string[],
  isIncompleteAllowed = false,
): number {
  if (!isIncompleteAllowed && result.failed > 0) return INCOMPLETE_EXIT_CODE;
  return hasFailingFinding(result, failOn) ? FINDINGS_EXIT_CODE : 0;
}

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

/**
 * The base the run compares against: `--base`, else the repository's default branch, said at INFO.
 *
 * @returns The ref; for `--uncommitted`, which compares against `HEAD`, the base is unused. A `--since` run
 * with no base to be found falls back to its own starting point, so the reviewed diff decides which bypass
 * markers are the change's.
 * @throws {@link OperatorError} for a branch or `--since` review with no base named and none to be found.
 */
export async function resolveBase(
  arguments_: Pick<ReviewArguments, "base" | "uncommitted" | "since">,
  git: Pick<GitReader, "defaultBase">,
  logger: Logger,
): Promise<string> {
  if (arguments_.base !== null) return arguments_.base;
  if (arguments_.uncommitted) return HEAD;
  const found = await git.defaultBase();
  if (found !== null) {
    logger
      .child("run")
      .info(`Base: '${found}', the repository's default branch; --base names another.`);
    return found;
  }
  if (arguments_.since !== null) return arguments_.since;
  throw new OperatorError(
    "No base to compare against: there is no origin/HEAD, main or master here. Name one with --base.",
  );
}

/** The container request from the parsed arguments; a preview needs no model. */
function requestFrom(arguments_: ReviewArguments): RunRequest {
  return {
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
  const { config, logger, gitReader } = cradle;
  const reporter = cradle.branchReporter;
  const options = {
    base: await resolveBase(arguments_, gitReader, logger),
    uncommitted: arguments_.uncommitted,
    ...(arguments_.since !== null && { since: arguments_.since }),
    reviewer: cradle.fileReviewer,
    verifier: cradle.verifier,
    git: gitReader,
    settings: config.fileReviewSettings(arguments_.exclude),
    skills: await cradle.skills,
    maxConcurrentFiles: config.concurrency().files,
    maxFindingsPerFile: config.reportPolicy().maxFindingsPerFile,
    codeContext: cradle.codeContext,
    policyPaths: cradle.policyPaths,
    logger,
  };

  let result: BranchReviewResult;
  try {
    result = await streamBranchReview(options, reporter);
  } finally {
    await closeReporter(reporter);
  }
  return exitCodeFor(result, arguments_.failOn, arguments_.allowIncomplete);
}

/** `--preview`: prints the selection. Never touches the model or the verifier, so no credential is needed. */
async function runPreview(arguments_: ReviewArguments, cradle: RunCradle): Promise<void> {
  const { config, logger, gitReader } = cradle;
  const { report } = await previewBranch({
    base: await resolveBase(arguments_, gitReader, logger),
    uncommitted: arguments_.uncommitted,
    ...(arguments_.since !== null && { since: arguments_.since }),
    git: gitReader,
    settings: config.fileReviewSettings(arguments_.exclude),
    policyPaths: cradle.policyPaths,
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
  const { config, logger, modelProviders } = cradle;
  // At INFO: which model, and where the key goes. `local` without a base URL is the OpenAI API, which a
  // reader of the name alone would not guess.
  const target = modelProviders.get(config.provider).target(config.llmSettings());
  logger.child("run").info(`Model: ${target} (provider ${config.provider}).`);
  return runBranchReview(arguments_, cradle);
}
