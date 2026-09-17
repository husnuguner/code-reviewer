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
import { type LLMProviderRegistry } from "../core/llm/provider-registry";
import { type ChatModel } from "../core/ports/chat-model";
import { type ConsoleOutput } from "../core/ports/console";
import { type Logger } from "../core/ports/logger";
import { type BranchReviewReporter, type PreviewReporter } from "../core/ports/review-reporter";
import { type ReportFormatRegistry, type SummaryWriter } from "../core/reporting/format-registry";
import { type PerFileVerifier } from "../core/review/changed-file";
import { FileReviewer } from "../core/review/file-reviewer";
import { systemPrompt } from "../core/review/prompts";
import { FindingVerifier } from "../core/review/verify";
import { loadRunConfig } from "../infra/config/loader";
import { configHome, configPath } from "../infra/config/paths";
import { builtinLLMProviderRegistry } from "../infra/llm/index";
import { PinoLogger } from "../infra/logging/pino-logger";
import { catalogDirectory, readReviewPolicy } from "../infra/prompts/policy-files";
import { builtinReportFormatRegistry } from "../infra/reporters/index";
import { NdjsonReporter, StreamConsole, TeeReporter, lineWriter } from "../infra/reporters/stdout";
import { shippedFile } from "../infra/shipped-files";

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
  readonly verbose: boolean;
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
  readonly llmProviders: LLMProviderRegistry;
  /** The renderings `--format` may name. */
  readonly reportFormats: ReportFormatRegistry;
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
}

/**
 * The reporter the requested format asks for.
 *
 * `--out` is orthogonal to the format on purpose: CI wants findings *on the
 * diff* (annotations) and a machine-readable copy for whatever posts the
 * comments afterwards, and making those two the same choice would force one
 * run per consumer -- which means paying the model twice for one answer.
 */
function buildBranchReporter(
  request: RunRequest,
  formats: ReportFormatRegistry,
): BranchReviewReporter {
  // The format is *looked up*, never branched on: adding a rendering is
  // registering a strategy, not editing this function.
  const primary = formats.build(request.format, {
    write: lineWriter(process.stdout),
    summary: summarySink(),
  });
  return request.outFile === null
    ? primary
    : new TeeReporter([primary, NdjsonReporter.toFile(request.outFile)]);
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
      PinoLogger.console({ verbose: r.verbose }),
    ).singleton(),
    llmProviders: asFunction(() => builtinLLMProviderRegistry()).singleton(),
    reportFormats: asFunction(() => builtinReportFormatRegistry()).singleton(),
    config: asFunction(({ request: r, llmProviders, logger }: RunCradle) =>
      loadRunConfig({
        project: r.project,
        configFile: r.configFile,
        overrides: r.overrides,
        requiresModel: r.requiresModel,
        providerNames: llmProviders.names(),
        cpuCount: availableParallelism(),
        logger,
      }),
    ).singleton(),
    chatModel: asFunction(({ config, llmProviders }: RunCradle) =>
      llmProviders.build(config.providerSettings()),
    ).singleton(),
    // The operator's review policy (or the shipped one) over the fixed contract.
    systemPrompt: asFunction(({ config, catalogPath }: RunCradle) =>
      systemPrompt(
        readReviewPolicy(config.promptFiles, catalogDirectory(catalogPath)) ??
          shippedFile("prompts/system.md"),
        shippedFile("prompts/output-contract.md"),
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
    branchReporter: asFunction(({ request: r, reportFormats }: RunCradle) =>
      buildBranchReporter(r, reportFormats),
    ).singleton(),
    configHomePath: asFunction(() => configHome()).singleton(),
    // `existsSync` makes the lookup real: a repository's own `.review/` is
    // found from the working directory upwards, and only its absence falls
    // through to the machine-wide catalogue.
    catalogPath: asFunction(({ request: r }: RunCradle) =>
      configPath(r.configFile, process.env, undefined, existsSync),
    ).singleton(),
  });
  return container;
}
