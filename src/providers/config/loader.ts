/**
 * One run's configuration from disk and environment. I/O glue only; meaning is the core's.
 * @packageDocumentation
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

import { configIncoherences } from "../../core/config/coherence";
import {
  type Config,
  type ConfigField,
  type RegisteredProviders,
  buildConfig,
} from "../../core/config/config";
import { type Logger, NULL_LOGGER } from "../../core/ports/logger";

import { environmentFilePaths, mergedEnvironment, readEnvironmentFile } from "./environment-files";
import { ENV_FILENAME, type Environment, configHome, configPaths } from "./paths";
import { loadConfigFiles } from "./reader";

/** Options for {@link loadRunConfig}. */
export interface LoadRunConfigOptions {
  /** `--config`: another file for the repository slot. */
  readonly configFile?: string | null;
  readonly overrides?: Readonly<Partial<Record<ConfigField, unknown>>>;
  /** `false` for a flow that builds no model (`--preview`). */
  readonly requiresModel?: boolean;
  /** `LLM_PROVIDER` must name one of these. */
  readonly providers: RegisteredProviders;
  readonly cpuCount: number | null;
  readonly environment?: Environment;
  readonly cwd?: string;
  readonly logger?: Logger;
}

/**
 * Names the `.env` files a run read, never a value; and, at DEBUG, a working directory's `.env` it did not.
 *
 * @remarks A `.env` decides which key goes where; reading one in silence was how a checkout's `.env` could
 * configure a run unseen.
 */
function sayWhichEnvironmentFiles(read: readonly string[], cwd: string, logger: Logger): void {
  const log = logger.child("config");
  if (read.length > 0) log.info(`.env files, lowest first: ${read.join(" < ")}.`);
  const ignored = join(cwd, ENV_FILENAME);
  if (!read.includes(ignored) && existsSync(ignored)) {
    log.debug(`${ignored} is not read: the working directory is the checkout under review.`);
  }
}

/**
 * Resolves one run's configuration: command line › environment and `.env` › repository file › machine file ›
 * defaults.
 *
 * @returns The validated `Config`.
 */
export function loadRunConfig(options: LoadRunConfigOptions): Config {
  const processEnvironment = options.environment ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const logger = options.logger ?? NULL_LOGGER;
  const paths = configPaths(options.configFile, processEnvironment, cwd);
  const environmentFiles = environmentFilePaths(paths.repo, processEnvironment).filter((path) =>
    existsSync(path),
  );
  const environment = mergedEnvironment(
    processEnvironment,
    environmentFiles.map(readEnvironmentFile),
  );
  sayWhichEnvironmentFiles(environmentFiles, cwd, logger);
  const files = loadConfigFiles(paths, environment, logger);
  if (files.length > 0) {
    logger
      .child("config")
      .info(`Config files, lowest first: ${files.map((file) => file.source).join(" < ")}.`);
  }
  const config = buildConfig({
    environment,
    files,
    ...(options.overrides && { overrides: options.overrides }),
    ...(options.requiresModel !== undefined && { requiresModel: options.requiresModel }),
    providers: options.providers,
    cpuCount: options.cpuCount,
    configHome: configHome(processEnvironment),
  });
  // Said once, where the whole configuration is first in hand: a setting that contradicts another is legal
  // and so passes validation, but it decides what the run will quietly not do.
  for (const line of configIncoherences(config)) logger.child("config").warn(line);
  return config;
}
