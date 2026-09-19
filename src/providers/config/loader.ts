/**
 * One run's configuration from disk and environment. I/O glue only; meaning is the core resolver's.
 * @packageDocumentation
 */

import { homedir } from "node:os";
import { dirname } from "node:path";

import { type Config, type ConfigField, type RegisteredProviders } from "../../core/config/config";
import { type ConfigSources, resolveConfig } from "../../core/config/resolver";
import { type Logger, NULL_LOGGER } from "../../core/ports/logger";
import { type Environment, configHome } from "../catalog/paths";
import { loadCatalog } from "../catalog/reader";

import { environmentFilePaths, readEnvironmentFile } from "./environment-files";

/** Options for {@link loadRunConfig}. */
export interface LoadRunConfigOptions {
  readonly project?: string | null;
  readonly configFile?: string | null;
  readonly overrides?: Readonly<Partial<Record<ConfigField, unknown>>>;
  /** `false` for a flow that builds no model (`--preview`). */
  readonly requiresModel?: boolean;
  /** `LLM_PROVIDER` must name one of these. */
  readonly providers: RegisteredProviders;
  readonly cpuCount: number | null;
  readonly environment?: Environment;
  readonly cwd?: string;
  readonly home?: string;
  readonly logger?: Logger;
}

/**
 * Resolves one run's configuration: command line › environment and `.env` › catalogue project › defaults.
 *
 * @returns The validated `Config`.
 */
export function loadRunConfig(options: LoadRunConfigOptions): Config {
  const environment = options.environment ?? process.env;
  const home = options.home ?? homedir();
  const cwd = options.cwd ?? process.cwd();
  const logger = options.logger ?? NULL_LOGGER;
  const sources: ConfigSources = {
    processEnv: environment,
    envFiles: environmentFilePaths(environment, cwd, home).map(readEnvironmentFile),
  };
  const catalog = loadCatalog(options.configFile, environment, logger, home, cwd);
  return resolveConfig({
    catalog,
    ...(catalog !== null && { catalogDirectory: dirname(catalog.source) }),
    project: options.project ?? null,
    ...(options.overrides && { overrides: options.overrides }),
    ...(options.requiresModel !== undefined && { requiresModel: options.requiresModel }),
    sources,
    configHome: configHome(environment, home),
    providers: options.providers,
    cpuCount: options.cpuCount,
    logger,
  });
}
