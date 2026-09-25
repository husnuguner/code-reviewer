/**
 * The composition root: where ports meet adapters, built per run from the parsed command line. Nothing
 * here talks to a hosting system; the only credential in the graph is the model's.
 * @packageDocumentation
 */

import { appendFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";

import {
  InjectionMode,
  type AwilixContainer,
  aliasTo,
  asFunction,
  asValue,
  createContainer,
} from "awilix";

import { type Config, type ConfigField } from "../core/config/config";
import { type ChatModel } from "../core/ports/chat-model";
import { type CodeContext } from "../core/ports/code-context";
import { type ConsoleOutput } from "../core/ports/console";
import { type GitReader } from "../core/ports/git-reader";
import { type LanguageLookup } from "../core/ports/language";
import { type Logger } from "../core/ports/logger";
import {
  type BranchReviewReporter,
  type PreviewReporter,
  type SummaryWriter,
} from "../core/ports/review-reporter";
import { type SkillMatcher } from "../core/ports/skill-matcher";
import { HEAD } from "../core/review/branch-review";
import { FileReviewer } from "../core/review/file-reviewer";
import { type PolicyPath } from "../core/review/policy";
import { systemPrompt } from "../core/review/prompts";
import { type PerFileVerifier } from "../core/review/review-file";
import { FindingVerifier } from "../core/review/verify";
import { SkillRegistry } from "../core/skills/registry";
import { promptsDirectory, readStandingInstructions } from "../providers/assets/project-prompts";
import { shippedFile } from "../providers/assets/shipped-files";
import { loadRunConfig } from "../providers/config/loader";
import {
  type ConfigPaths,
  type Environment,
  configHome,
  configPaths,
  expandUser,
  findGitRoot,
  insideCheckout,
  repoRootOf,
} from "../providers/config/paths";
import { StreamConsole } from "../providers/console/stream-console";
import { GitCodeContext } from "../providers/git/git-code-context";
import { LocalGitReader, worktree } from "../providers/git/local-git";
import { builtinLanguages } from "../providers/languages/builtin";
import { builtinModelProviders } from "../providers/llm/builtin";
import { type ModelProviderRegistry } from "../providers/llm/model-provider";
import { RetryingChatModel } from "../providers/llm/retrying-chat-model";
import { type LogSettings } from "../providers/logging/log-settings";
import { PinoLogger } from "../providers/logging/pino-logger";
import { builtinFormatProviders } from "../providers/reporting/builtin";
import { type FormatProviderRegistry } from "../providers/reporting/format-provider";
import { lineWriter } from "../providers/reporting/line-writer";
import { NdjsonFileReporter } from "../providers/reporting/ndjson/file-reporter";
import { TeeReporter } from "../providers/reporting/tee";
import {
  DirectorySkillSource,
  WorktreeSkillSource,
  isLocalSkillsPath,
} from "../providers/skills/sources";

/** A format name, validated against the registry rather than a union. */
export type ReportFormat = string;

/** What the command line asked for, already parsed. */
export interface RunRequest {
  /** `--config`: another file for the repository slot, or `null` for the usual lookup. */
  readonly configFile: string | null;
  /** Logging, already settled by the command line. */
  readonly logging: LogSettings;
  /** Command-line settings that outrank every other layer. */
  readonly overrides: Readonly<Partial<Record<ConfigField, unknown>>>;
  /** Whether the flow builds a model and therefore needs its key. */
  readonly requiresModel: boolean;
  readonly format: ReportFormat;
  /** `--out`, or `null`. */
  readonly outFile: string | null;
  /** Where the run was started; `process.cwd()` unless a test says otherwise. */
  readonly cwd?: string;
  /** The environment read for `LLM_*`, `REVIEW_*` and `XDG_CONFIG_HOME`; `process.env` unless a test says otherwise. */
  readonly environment?: Environment;
}

/** Everything a run can ask the container for. */
export interface RunCradle {
  readonly request: RunRequest;
  readonly logger: Logger;
  /** The vendors `LLM_PROVIDER` may name. */
  readonly modelProviders: ModelProviderRegistry;
  /** The renderings `--format` may name. */
  readonly formatProviders: FormatProviderRegistry;
  readonly config: Config;
  readonly chatModel: ChatModel;
  /** The composed system prompt. */
  readonly systemPrompt: string;
  readonly fileReviewer: FileReviewer;
  /** The verification pass, or `null` when turned off. */
  readonly verifier: PerFileVerifier | null;
  readonly console: ConsoleOutput;
  /** Where `--preview` prints. */
  readonly previewReporter: PreviewReporter;
  /** Where the run's records go, as `--format` chose. */
  readonly branchReporter: BranchReviewReporter;
  readonly configHomePath: string;
  /** The machine's config file and, when the run is inside a checkout that carries one, the repository's. */
  readonly configFilePaths: ConfigPaths;
  /**
   * The checkout reviewed: the repository owning the `.review/config.yaml` that was found; when the config
   * file was named by hand (it may lie anywhere, a base branch's copy included), the repository containing cwd.
   */
  readonly checkoutRoot: string;
  /** Where this run's policy lives inside the checkout: its config file, prompts and skills, when they are in it. */
  readonly policyPaths: readonly PolicyPath[];
  /** Local git over that checkout. */
  readonly gitReader: GitReader;
  /** The checkout beyond the diff, read at `HEAD`, for pre-context. */
  readonly codeContext: CodeContext;
  /** Which language reads each file for pre-context: the built-in ones, plain text for the rest. */
  readonly languages: LanguageLookup;
  /** The project's skills, loaded and scoped by its mappings; resolved once per run. */
  readonly skills: Promise<SkillMatcher>;
}

/** A skill source for the path: a directory on this machine (`~` expanded), or one inside the checkout. */
function skillSource(root: string, path: string, logger: Logger): DirectorySkillSource {
  return isLocalSkillsPath(path)
    ? new DirectorySkillSource(expandUser(path.trim()), { logger })
    : new WorktreeSkillSource(root, path, { logger });
}

/**
 * The reporter for the requested format, teed into the `--out` file when one is named.
 *
 * @remarks Opens the `--out` file, so the flow resolves this before asking a model anything.
 */
function buildBranchReporter(
  request: RunRequest,
  formats: FormatProviderRegistry,
): BranchReviewReporter {
  const primary = formats.create(request.format, {
    write: lineWriter(process.stdout),
    summary: summarySink(),
  });
  return request.outFile === null
    ? primary
    : new TeeReporter([primary, NdjsonFileReporter.open(request.outFile)]);
}

/** Appends to `$GITHUB_STEP_SUMMARY`, or `null` outside a runner. */
function summarySink(): SummaryWriter | null {
  const path = process.env["GITHUB_STEP_SUMMARY"];
  return path === undefined || path === ""
    ? null
    : (markdown) => {
        appendFileSync(path, `${markdown}\n`);
      };
}

/** Builds the run's dependency graph. Resolution is lazy: nothing is opened until asked for. */
export function buildContainer(request: RunRequest): AwilixContainer<RunCradle> {
  const container = createContainer<RunCradle>({
    injectionMode: InjectionMode.PROXY,
    strict: true,
  });
  container.register({
    request: asValue(request),
    logger: asFunction(({ request: r }: RunCradle) =>
      PinoLogger.console({ settings: r.logging }),
    ).singleton(),
    modelProviders: asFunction(() => builtinModelProviders()).singleton(),
    formatProviders: asFunction(() => builtinFormatProviders()).singleton(),
    config: asFunction(({ request: r, modelProviders, logger }: RunCradle) => {
      const config = loadRunConfig({
        configFile: r.configFile,
        overrides: r.overrides,
        requiresModel: r.requiresModel,
        providers: { names: modelProviders.names(), default: modelProviders.defaultName() },
        cpuCount: availableParallelism(),
        ...(r.environment && { environment: r.environment }),
        ...(r.cwd !== undefined && { cwd: r.cwd }),
        logger,
      });
      // The key may have come from a `.env` or a config file, where no variable name says it is one.
      if (logger instanceof PinoLogger) logger.mask(config.apiKey);
      return config;
    }).singleton(),
    // The retry decorator wraps here, so "try again, and say so" is one policy for every vendor.
    chatModel: asFunction(
      ({ config, modelProviders, logger }: RunCradle) =>
        new RetryingChatModel(modelProviders.create(config.provider, config.llmSettings()), {
          logger,
        }),
    ).singleton(),
    systemPrompt: asFunction(({ configFilePaths: paths, logger }: RunCradle) =>
      systemPrompt(
        shippedFile("prompts/system.md"),
        shippedFile("prompts/output-contract.md"),
        readStandingInstructions(
          paths.repo === null ? null : promptsDirectory(paths.repo),
          promptsDirectory(paths.machine),
          logger,
        ),
      ),
    ).singleton(),
    fileReviewer: asFunction(
      ({ chatModel, systemPrompt: prompt, logger }: RunCradle) =>
        new FileReviewer(chatModel, { systemPrompt: prompt, logger }),
    ).singleton(),
    verifier: asFunction(({ config, chatModel, logger }: RunCradle) =>
      config.verifyFindings
        ? new FindingVerifier(chatModel, {
            systemPrompt: shippedFile("prompts/verify.md"),
            logger,
          })
        : null,
    ).singleton(),
    console: asFunction(() => new StreamConsole(process.stdout)).singleton(),
    previewReporter: aliasTo("console"),
    branchReporter: asFunction(({ request: r, formatProviders }: RunCradle) =>
      buildBranchReporter(r, formatProviders),
    ).singleton(),
    checkoutRoot: asFunction(({ request: r, configFilePaths: paths }: RunCradle) => {
      const cwd = r.cwd ?? process.cwd();
      return worktree(
        paths.repo !== null && !paths.isRepoNamed
          ? repoRootOf(paths.repo)
          : (findGitRoot(cwd) ?? cwd),
      );
    }).singleton(),
    policyPaths: asFunction(({ config, configFilePaths: paths, checkoutRoot }: RunCradle) => {
      const skills = config.skillSettings().path.trim();
      const candidates = [
        ...(paths.repo === null ? [] : [paths.repo, promptsDirectory(paths.repo)]),
        // Spelled the way `skillSource` reads it: on its own, or from the checkout root.
        ...(skills === ""
          ? []
          : [isLocalSkillsPath(skills) ? expandUser(skills) : join(checkoutRoot, skills)]),
      ];
      return candidates.flatMap((path) => {
        const inside = insideCheckout(checkoutRoot, path);
        return inside === null ? [] : [inside];
      });
    }).singleton(),
    gitReader: asFunction(
      ({ checkoutRoot, logger }: RunCradle) => new LocalGitReader(checkoutRoot, undefined, logger),
    ).singleton(),
    languages: asFunction(() => builtinLanguages()).singleton(),
    codeContext: asFunction(
      ({ checkoutRoot, logger }: RunCradle) =>
        new GitCodeContext(checkoutRoot, HEAD, undefined, logger),
    ).singleton(),
    skills: asFunction(({ config, checkoutRoot, logger }: RunCradle) => {
      const { path, defaults, mappings } = config.skillSettings();
      return SkillRegistry.build(
        [skillSource(checkoutRoot, path, logger)],
        logger,
        mappings,
        defaults,
      );
    }).singleton(),
    configHomePath: asFunction(({ request: r }: RunCradle) =>
      configHome(r.environment ?? process.env),
    ).singleton(),
    configFilePaths: asFunction(({ request: r }: RunCradle) =>
      configPaths(r.configFile, r.environment ?? process.env, r.cwd ?? process.cwd()),
    ).singleton(),
  });
  return container;
}
