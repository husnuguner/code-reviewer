/**
 * The composition root: where ports meet adapters.
 *
 * Nothing in `core/` knows which adapter it runs against; this is the one
 * place that decides. The container is built per run from the parsed command
 * line, and the flow receives fully constructed collaborators. A UI or a
 * server builds its own root with different reporters and the same core.
 *
 * Note what is *not* wired here: nothing that talks to a hosting system. The
 * reviewer reads local git and writes to a stream, so the only credential in
 * the graph is the model's, and a run that cannot reach the network can still
 * be a complete run.
 */

import { appendFileSync, existsSync } from "node:fs";
import { availableParallelism } from "node:os";

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
import { type ConsoleOutput } from "../core/ports/console";
import { type GitReader } from "../core/ports/git-reader";
import { type Logger } from "../core/ports/logger";
import {
  type BranchReviewReporter,
  type PreviewReporter,
  type SummaryWriter,
} from "../core/ports/review-reporter";
import { type SkillMatcher } from "../core/ports/skill-matcher";
import { FileReviewer } from "../core/review/file-reviewer";
import { systemPrompt } from "../core/review/prompts";
import { type PerFileVerifier } from "../core/review/review-file";
import { FindingVerifier } from "../core/review/verify";
import { SkillRegistry } from "../core/skills/registry";
import { promptsDirectory, readProjectPrompts } from "../providers/assets/project-prompts";
import { shippedFile } from "../providers/assets/shipped-files";
import {
  configHome,
  configPath,
  expandUser,
  isRepoConfig,
  repoRootOf,
} from "../providers/catalog/paths";
import { loadRunConfig } from "../providers/config/loader";
import { StreamConsole } from "../providers/console/stream-console";
import { LocalGitReader, worktree } from "../providers/git/local-git";
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

/**
 * Where a run's findings go, as the command line spells it.
 *
 * A plain string, validated against the registry rather than against a union:
 * a format is registered, not declared in three places.
 */
export type ReportFormat = string;

/** What the command line asked for, already parsed. */
export interface RunRequest {
  readonly project: string | null;
  readonly configFile: string | null;
  /**
   * How much the run says, in what shape, in colour or not -- already
   * settled by the command line (see `commands/shared`). The container takes
   * a decision rather than the flags behind it, so building a logger reads
   * no environment variable and asks no question of the terminal.
   */
  readonly logging: LogSettings;
  /** Command-line settings that outrank every other layer. */
  readonly overrides: Readonly<Partial<Record<ConfigField, unknown>>>;
  /** Whether the flow builds a language model and therefore needs its key. */
  readonly requiresModel: boolean;
  readonly format: ReportFormat;
  /** `--out`: a file every record is also written to as NDJSON, or `null`. */
  readonly outFile: string | null;
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
  /** The composed system prompt: the policy in force over the output contract. */
  readonly systemPrompt: string;
  readonly fileReviewer: FileReviewer;
  /** The verification pass, or `null` when the run turned it off. */
  readonly verifier: PerFileVerifier | null;
  readonly console: ConsoleOutput;
  /** Where `--preview` prints the file selection. */
  readonly previewReporter: PreviewReporter;
  /** Where the run's records go, as `--format` chose. */
  readonly branchReporter: BranchReviewReporter;
  readonly configHomePath: string;
  readonly catalogPath: string;
  /**
   * Where this run's standing instructions are read from: `prompts/` beside
   * the catalogue. A convention, not a setting -- see `project-prompts`.
   */
  readonly promptsPath: string;
  /**
   * The checkout the run reviews. A project's `local-path` wins; without one,
   * a repository's own catalogue names its repository, so `reviewer` run from
   * any subdirectory reviews that checkout -- the way `git` finds its
   * repository. Only a machine-wide catalogue falls back to the current
   * directory.
   */
  readonly checkoutRoot: string;
  /** Local git over that checkout: the diff source and the file reader. */
  readonly gitReader: GitReader;
  /**
   * The project's skills, loaded and scoped by its mappings. Resolved once
   * per run; the source is a directory on this machine or one inside the
   * checkout, decided by the shape of `skills.path`.
   */
  readonly skills: Promise<SkillMatcher>;
}

/** Skills from a directory on this machine, `~` expanded. */
function skillSource(root: string, path: string, logger: Logger): DirectorySkillSource {
  return isLocalSkillsPath(path)
    ? new DirectorySkillSource(expandUser(path.trim()), { logger })
    : new WorktreeSkillSource(root, path, { logger });
}

/**
 * The reporter the requested format asks for.
 *
 * `--out` is orthogonal to the format on purpose: CI wants findings *on the
 * diff* (annotations) and a machine-readable copy for whatever posts the
 * comments afterwards, and making those two the same choice would force one
 * run per consumer -- which means paying the model twice for one answer.
 *
 * Building this opens the `--out` file, so a path the filesystem refuses is
 * refused here -- which is why the review flow resolves the reporter before
 * it asks a model anything.
 */
function buildBranchReporter(
  request: RunRequest,
  formats: FormatProviderRegistry,
): BranchReviewReporter {
  // The format is *looked up*, never branched on: adding a rendering is
  // registering a strategy, not editing this function.
  const primary = formats.create(request.format, {
    write: lineWriter(process.stdout),
    summary: summarySink(),
  });
  return request.outFile === null
    ? primary
    : new TeeReporter([primary, NdjsonFileReporter.open(request.outFile)]);
}

/**
 * Appends to the job summary GitHub names, or nothing outside a runner.
 *
 * Absent `GITHUB_STEP_SUMMARY` this is not an error: the same command is
 * meant to be runnable on a laptop, where there is simply no summary to
 * write to.
 */
function summarySink(): SummaryWriter | null {
  const path = process.env["GITHUB_STEP_SUMMARY"];
  return path === undefined || path === ""
    ? null
    : (markdown) => {
        appendFileSync(path, `${markdown}\n`);
      };
}

/** Build the run's dependency graph. Resolution is lazy: nothing is opened until asked for. */
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
    config: asFunction(({ request: r, modelProviders, logger }: RunCradle) =>
      loadRunConfig({
        project: r.project,
        configFile: r.configFile,
        overrides: r.overrides,
        requiresModel: r.requiresModel,
        // Which vendors exist and which is meant when none is named are the
        // registry's facts; the configuration is told them, it does not hold them.
        providers: { names: modelProviders.names(), default: modelProviders.defaultName() },
        cpuCount: availableParallelism(),
        logger,
      }),
    ).singleton(),
    // The registry builds the vendor's adapter; the decorator decides what a
    // failed call means. Wrapping here rather than inside each provider is
    // what keeps "try again, and say so" one policy instead of one per vendor
    // -- and what lets a test build the bare model.
    chatModel: asFunction(
      ({ config, modelProviders, logger }: RunCradle) =>
        new RetryingChatModel(modelProviders.create(config.provider, config.llmSettings()), {
          logger,
        }),
    ).singleton(),
    // Two of the three parts are the reviewer's own and are not replaceable:
    // the policy states the lenses and the hard rules, the contract states
    // the JSON that comes back. Between them go the project's own standing
    // instructions: every Markdown file in the `prompts/` directory beside
    // the catalogue, each under its own heading.
    systemPrompt: asFunction(({ promptsPath, logger }: RunCradle) =>
      systemPrompt(
        shippedFile("prompts/system.md"),
        shippedFile("prompts/output-contract.md"),
        readProjectPrompts(promptsPath, logger),
      ),
    ).singleton(),
    fileReviewer: asFunction(
      ({ chatModel, systemPrompt: prompt, logger }: RunCradle) =>
        new FileReviewer(chatModel, { systemPrompt: prompt, logger }),
    ).singleton(),
    // Verification is a policy the core owns, so it is not composed from the
    // operator's prompts: `null` here is the whole of turning it off.
    verifier: asFunction(({ config, chatModel, logger }: RunCradle) =>
      config.verifyFindings
        ? new FindingVerifier(chatModel, {
            systemPrompt: shippedFile("prompts/verify.md"),
            logger,
          })
        : null,
    ).singleton(),
    console: asFunction(() => new StreamConsole(process.stdout)).singleton(),
    // A preview's selection is ordinary console output.
    previewReporter: aliasTo("console"),
    branchReporter: asFunction(({ request: r, formatProviders }: RunCradle) =>
      buildBranchReporter(r, formatProviders),
    ).singleton(),
    checkoutRoot: asFunction(({ config, catalogPath }: RunCradle) => {
      const fallback = isRepoConfig(catalogPath) ? repoRootOf(catalogPath) : "";
      return worktree(config.localPath === "" ? fallback : config.localPath);
    }).singleton(),
    gitReader: asFunction(
      ({ checkoutRoot, logger }: RunCradle) => new LocalGitReader(checkoutRoot, undefined, logger),
    ).singleton(),
    skills: asFunction(({ config, checkoutRoot, logger }: RunCradle) => {
      const { path, mappings } = config.skillSettings();
      // An empty path yields an empty registry; the source handles it.
      return SkillRegistry.build([skillSource(checkoutRoot, path, logger)], logger, mappings);
    }).singleton(),
    configHomePath: asFunction(() => configHome()).singleton(),
    // `existsSync` makes the lookup real: a repository's own `.review/` is
    // found from the working directory upwards, and only its absence falls
    // through to the machine-wide catalogue.
    catalogPath: asFunction(({ request: r }: RunCradle) =>
      configPath(r.configFile, process.env, undefined, existsSync),
    ).singleton(),
    // Beside the catalogue, wherever that turned out to be: a repository's
    // own `.review/prompts/`, or the machine's `~/.config/reviewer/prompts/`
    // for a checkout that carries no rules of its own.
    promptsPath: asFunction(({ catalogPath }: RunCradle) =>
      promptsDirectory(catalogPath),
    ).singleton(),
  });
  return container;
}
