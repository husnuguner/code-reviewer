/**
 * One run's configuration from disk and environment. I/O glue only; meaning is the core resolver's.
 * @packageDocumentation
 */

import { type Config, type ConfigField, type RegisteredProviders } from "../../core/config/config";
import { type ConfigSources, resolveConfig } from "../../core/config/resolver";
import { type Logger, NULL_LOGGER } from "../../core/ports/logger";

import { environmentFilePaths, readEnvironmentFile } from "./environment-files";
import { type Environment, configHome, configPaths } from "./paths";
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
 * Resolves one run's configuration: command line › environment and `.env` › repository file › machine file ›
 * defaults.
 *
 * @returns The validated `Config`.
 */
export function loadRunConfig(options: LoadRunConfigOptions): Config {
  const environment = options.environment ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const logger = options.logger ?? NULL_LOGGER;
  const sources: ConfigSources = {
    processEnv: environment,
    envFiles: environmentFilePaths(environment, cwd).map(readEnvironmentFile),
  };
  const files = loadConfigFiles(configPaths(options.configFile, environment, cwd), logger);
  return resolveConfig({
    files,
    ...(options.overrides && { overrides: options.overrides }),
    ...(options.requiresModel !== undefined && { requiresModel: options.requiresModel }),
    sources,
    configHome: configHome(environment),
    providers: options.providers,
    cpuCount: options.cpuCount,
    logger,
  });
}
