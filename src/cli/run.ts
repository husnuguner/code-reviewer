/**
 * The command line: `reviewer [--project NAME] [--branch X] [--base Y]`,
 * `reviewer init`, `reviewer projects`.
 *
 * One flow, one project per run: compare a branch against a base from local
 * git, review what changed, and report it. Nothing is posted and no hosting
 * credential is read -- turning a finding into a pull-request comment is a CI
 * bot's job, downstream of the NDJSON this prints.
 *
 * Parsing is separated from running so the flags can be tested without a
 * container.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { Command, CommanderError, InvalidArgumentError } from "commander";

import { type CatalogFiles, addProject, initCatalog, listProjects } from "../core/catalog/commands";
import { type ConfigField, ConfigError } from "../core/config/config";
import { type ConsoleOutput } from "../core/ports/console";
import { type Logger } from "../core/ports/logger";
import {
  type BranchReviewResult,
  previewBranch,
  streamBranchReview,
} from "../core/review/branch-review";
import { SEVERITIES } from "../core/review/severity";
import { SkillRegistry } from "../core/skills/registry";
import { CatalogError, GitError } from "../core/util/errors";
import { FsCatalogFiles } from "../infra/config/catalog-files";
import { loadCatalog } from "../infra/config/loader";
import { expandUser } from "../infra/config/paths";
import { GitCodeContext } from "../infra/git/git-code-context";
import { LocalGitReader, worktree } from "../infra/git/local-git";
import { builtinReportFormatRegistry } from "../infra/reporters/index";
import { shippedFile } from "../infra/shipped-files";
import {
  DirectorySkillSource,
  WorktreeSkillSource,
  isLocalSkillsPath,
} from "../infra/skills/sources";

import { type ReportFormat, type RunCradle, type RunRequest, buildContainer } from "./container";

export type CliCommand = "review" | "init" | "projects" | "add";

/**
 * Where a newly added project's skills are read from, unless told otherwise.
 *
 * Inside the reviewed repository, because that is the only home that works
 * everywhere: the rules travel with the code they govern, a change to a
 * convention can ship in the same pull request as the code that follows it,
 * and a CI runner -- which has no `~/.config/reviewer` -- can still read them.
 */
export const DEFAULT_REPO_SKILLS = ".review/skills";

/**
 * The ref reviewed when `--branch` is not given.
 *
 * `HEAD` rather than a branch name because that is what a CI checkout has:
 * a pull-request build sits on a detached commit, and a flag that insisted on
 * a branch name would make the common case the awkward one.
 */
export const DEFAULT_BRANCH = "HEAD";

/** The parsed command line, one field per flag. */
export interface CliArguments {
  readonly command: CliCommand;
  readonly project: string | null;
  readonly config: string | null;
  /** The project to define, for `add`. */
  readonly name: string | null;
  /** `--path`: the checkout a newly added project reviews. */
  readonly path: string | null;
  /** `--skills`: where a newly added project's skills come from. */
  readonly skills: string;
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
  readonly failOn: readonly string[];
  /** False only when `--no-verify` was passed; otherwise the config decides. */
  readonly verify: boolean;
  readonly verbose: boolean;
}

/** A usage error, surfaced as a message and exit code instead of a thrown `CommanderError`. */
export class UsageError extends Error {
  override readonly name = "UsageError";

  constructor(
    message: string,
    readonly exitCode: number,
  ) {
    super(message);
  }
}

/** Exit code for a run that found something `--fail-on` named. */
export const FINDINGS_EXIT_CODE = 3;

/**
 * The renderings `--format` may name.
 *
 * Built once, at module scope, because the command line is parsed before any
 * container exists: `--format` has to be validated against the same registry
 * the composition root later builds through, or the two could disagree about
 * what a valid format is.
 */
const formats = builtinReportFormatRegistry();

/** The rendering a run takes when `--format` is not given: the first registered. */
const DEFAULT_FORMAT: ReportFormat = formats.names()[0] ?? "text";

function choice<T extends string>(allowed: readonly T[]): (value: string) => T {
  return (value) => {
    if (!allowed.includes(value as T)) {
      throw new InvalidArgumentError(`Allowed choices are ${allowed.join(", ")}.`);
    }
    return value as T;
  };
}

/** `--fail-on bug,security`, validated against the severity vocabulary. */
function severityList(value: string): string[] {
  const names = value
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter((name) => name !== "");
  // `none` is spelled out rather than left to an empty string: "--fail-on ''"
  // reads like a mistake, and a gate nobody meant to disable is the one that
  // silently stops failing builds.
  if (names.length === 1 && names[0] === "none") return [];
  const allowed: ReadonlySet<string> = new Set(SEVERITIES);
  for (const name of names) {
    if (!allowed.has(name)) {
      throw new InvalidArgumentError(`Allowed severities are ${SEVERITIES.join(", ")}, or none.`);
    }
  }
  return names;
}

/** The command line as a `Command`; exposed so `--help` output can be tested. */
export function buildProgram(): Command {
  const program = new Command("reviewer")
    .description(
      "Review a branch against a base from local git and report the findings " +
        "(bug/security/performance/readability). Nothing is posted: the findings go to stdout " +
        "as text, NDJSON or GitHub Actions annotations, and whatever comments on a pull request " +
        "reads them from there.",
    )
    .argument(
      "[command]",
      "'review' (default) reviews; 'init' writes a starter config.yaml; 'add' defines a project in it; 'projects' lists what it defines.",
      choice<CliCommand>(["review", "init", "projects", "add"]),
      "review",
    )
    .argument("[name]", "The project's name, for 'add'.")
    .option(
      "--path <dir>",
      "For 'add': the checkout the project reviews (default: the current directory).",
    )
    .option(
      "--skills <path>",
      `For 'add': where the project's skills are read from. A path inside the reviewed repository (default '${DEFAULT_REPO_SKILLS}') travels with the code and works in CI; an absolute or ~ path is a directory on this machine only.`,
      DEFAULT_REPO_SKILLS,
    )
    .option(
      "--project <name>",
      "Name of the project to review, as defined in config.yaml. Optional when the config defines exactly one, or when there is no config and the environment describes the target.",
    )
    .option(
      "--config <path>",
      "Path to config.yaml (overrides REVIEWER_CONFIG and the default under the user config directory).",
    )
    .option(
      "--branch <name>",
      `Branch or commit to review against --base (default: ${DEFAULT_BRANCH}, the current checkout).`,
      DEFAULT_BRANCH,
    )
    .option("--base <name>", "Base branch to compare against (default: main).", "main")
    // Both the accepted values and the help text come from the registry, so a
    // newly registered format is selectable and documented without an edit
    // here (see infra/reporters/index.ts).
    .option(
      "--format <format>",
      `How findings are reported: ${formats.describe()}. Logs always stay on stderr.`,
      choice(formats.names()),
      DEFAULT_FORMAT,
    )
    .option(
      "--out <path>",
      "Also write every record to this file as NDJSON, whatever --format prints. This is what a CI bot reads to post comments.",
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
    .option(
      "--exclude <glob>",
      "Glob of files to skip entirely (repeatable); adds to the project's exclude list. E.g. --exclude '**/*.md'.",
      (value: string, previous: string[]) => [...previous, value],
      [] as string[],
    )
    .option(
      "--fail-on <severities>",
      "Exit 3 when a surviving finding has one of these severities, e.g. 'bug,security' ('none' disables, the default). Reporting is unaffected: this only decides the exit code.",
      severityList,
      [] as string[],
    )
    .option(
      "--no-verify",
      "Report every finding the model produced, skipping the verification pass that removes the ones the diff refutes (one extra model call per file that found something).",
    )
    .option(
      "-v, --verbose",
      "Debug logging: DEBUG-level detail for reviewer.* (per-file decisions, skill matches).",
      false,
    )
    .allowExcessArguments(false)
    .exitOverride()
    .configureOutput({ writeErr: (text) => process.stderr.write(text) });
  return program;
}

/** Parse `argv` (without the executable and script) into typed arguments. */
export function parseArguments(argv: readonly string[]): CliArguments {
  const program = buildProgram();
  try {
    program.parse([...argv], { from: "user" });
  } catch (error) {
    if (error instanceof CommanderError) throw new UsageError(error.message, error.exitCode);
    throw error;
  }
  const options = program.opts<{
    project?: string;
    config?: string;
    path?: string;
    skills: string;
    branch: string;
    base: string;
    format: ReportFormat;
    out?: string;
    preview: boolean;
    lang?: string;
    skillsPath?: string;
    exclude: string[];
    failOn: string[];
    verify: boolean;
    verbose: boolean;
  }>();
  const [command, name] = program.processedArgs as [CliCommand, string | undefined];
  return {
    command,
    name: name ?? null,
    path: options.path ?? null,
    skills: options.skills,
    project: options.project ?? null,
    config: options.config ?? null,
    branch: options.branch,
    base: options.base,
    format: options.format,
    out: options.out ?? null,
    preview: options.preview,
    lang: options.lang ?? null,
    skillsPath: options.skillsPath ?? null,
    exclude: options.exclude,
    failOn: options.failOn,
    verify: options.verify,
    verbose: options.verbose,
  };
}

/**
 * The settings the command line states, which outrank every other layer.
 *
 * Only what was actually passed: an argument left at its default must not
 * shadow a project or environment value with it.
 */
export function cliOverrides(arguments_: CliArguments): Partial<Record<ConfigField, unknown>> {
  return {
    ...(arguments_.lang !== null && arguments_.lang !== "" && { reviewLang: arguments_.lang }),
    ...(arguments_.skillsPath !== null && { skillsPath: arguments_.skillsPath }),
    // Only the refusal is a command-line statement: there is no `--verify`,
    // so a run that did not say no leaves the question to the layers below.
    ...(!arguments_.verify && { verifyFindings: false }),
  };
}

/**
 * `reviewer add <name>`: define a project in the catalogue.
 *
 * The checkout defaults to the current directory, because the natural way to
 * run this is from inside the repository being added. `--skills` defaults to
 * a path *inside* that repository, so the rules are versioned with the code
 * they govern and CI can read them.
 */
function addNewProject(
  arguments_: CliArguments,
  files: CatalogFiles,
  out: ConsoleOutput,
  logger: Logger,
): number {
  const name = arguments_.name?.trim() ?? "";
  if (name === "") {
    throw new UsageError("add needs a project name: reviewer add <name> [--path <dir>]", 1);
  }
  const localPath = resolve(expandUser(arguments_.path ?? process.cwd()));
  if (!existsSync(localPath)) {
    throw new CatalogError(`${localPath} does not exist; --path must name a checkout.`);
  }
  const skills = arguments_.skills.trim();
  return addProject(loadCatalog(arguments_.config, process.env, logger), files, out, {
    name,
    localPath,
    // An absolute or ~ path is a directory on this machine; anything else is
    // read from inside the reviewed repository. Empty disables skills.
    skillsPath: skills === "" || isLocalSkillsPath(skills) ? null : skills,
  });
}

/** Skills from a directory on this machine, `~` expanded. */
function localSkillSource(path: string, logger: Logger): DirectorySkillSource {
  return new DirectorySkillSource(expandUser(path.trim()), { logger });
}

/**
 * Whether the run found something `--fail-on` named.
 *
 * Asked of the reported findings, not of everything the model said: a finding
 * verification refuted or the volume policy withheld is not a reason to fail
 * a build the reviewer never showed it to.
 */
export function hasFailingFinding(
  result: Pick<BranchReviewResult, "findings">,
  severities: readonly string[],
): boolean {
  if (severities.length === 0) return false;
  const gating = new Set(severities);
  return result.findings.some((finding) => gating.has(finding.severity.toLowerCase()));
}

/** Branch review: local git in, a reporter out. */
async function runBranchReview(arguments_: CliArguments, cradle: RunCradle): Promise<number> {
  const { config, logger } = cradle;
  const root = worktree(config.localPath);
  const git = new LocalGitReader(root, undefined, logger);
  // An empty skills path yields an empty registry; the source handles it.
  const skillSettings = config.skillSettings();
  const skills = await SkillRegistry.build(
    [
      isLocalSkillsPath(skillSettings.path)
        ? localSkillSource(skillSettings.path, logger)
        : new WorktreeSkillSource(root, skillSettings.path, { logger }),
    ],
    logger,
    skillSettings.mappings,
  );
  const options = {
    base: arguments_.base,
    branch: arguments_.branch,
    reviewer: cradle.fileReviewer,
    verifier: cradle.verifier,
    git,
    settings: config.fileReviewSettings(arguments_.exclude),
    skills,
    maxConcurrentFiles: config.concurrency().files,
    maxFindingsPerFile: config.reportPolicy().maxFindingsPerFile,
    codeContext: new GitCodeContext(root, arguments_.branch, undefined, logger),
    logger,
  };

  // Every run streams through the reporter, whatever the format: rendering is
  // the format's business, not this function's. That is also what makes
  // `--out` orthogonal, so a human-readable run still leaves behind the
  // machine-readable copy a CI bot reads.
  const result = await streamBranchReview(options, cradle.branchReporter);
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
async function runPreview(arguments_: CliArguments, cradle: RunCradle): Promise<void> {
  const { config, logger } = cradle;
  const root = worktree(config.localPath);
  const { report } = await previewBranch({
    base: arguments_.base,
    branch: arguments_.branch,
    git: new LocalGitReader(root, undefined, logger),
    settings: config.fileReviewSettings(arguments_.exclude),
    logger,
  });
  cradle.console.line(report);
}

/** What the container needs to know, straight from the parsed arguments. */
function requestFrom(arguments_: CliArguments): RunRequest {
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

async function runReview(arguments_: CliArguments, cradle: RunCradle): Promise<number> {
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

/** The process entry: parse, dispatch, and turn operator errors into plain messages. */
export async function main(argv: readonly string[]): Promise<number> {
  let arguments_: CliArguments;
  try {
    arguments_ = parseArguments(argv);
  } catch (error) {
    if (error instanceof UsageError) {
      if (error.exitCode !== 0) process.stderr.write(`${error.message}\n`);
      return error.exitCode;
    }
    throw error;
  }

  // Resolution is lazy, so `init` and `projects` never touch the settings or
  // the model: they only take the console, the paths and the logger.
  const { cradle } = buildContainer(requestFrom(arguments_));
  const { console: out, catalogPath, configHomePath, logger } = cradle;

  try {
    if (arguments_.command === "init") {
      return initCatalog(new FsCatalogFiles(catalogPath, configHomePath), out, {
        catalog: shippedFile("templates/config.yaml"),
        policy: shippedFile("prompts/system.md"),
      });
    }
    if (arguments_.command === "add") {
      return addNewProject(
        arguments_,
        new FsCatalogFiles(catalogPath, configHomePath),
        out,
        logger,
      );
    }
    return arguments_.command === "projects"
      ? listProjects(loadCatalog(arguments_.config, process.env, logger), catalogPath, out)
      : await runReview(arguments_, cradle);
  } catch (error) {
    // Configuration and working-tree problems are the operator's to fix, so
    // they get a plain message rather than a stack trace.
    if (
      error instanceof CatalogError ||
      error instanceof GitError ||
      error instanceof ConfigError
    ) {
      process.stderr.write(`error: ${error.message}\n`);
      return 2;
    }
    if (error instanceof UsageError) {
      process.stderr.write(`${error.message}\n`);
      return error.exitCode;
    }
    throw error;
  }
}
