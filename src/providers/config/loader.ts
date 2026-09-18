/**
 * One run's configuration, assembled from everything that may speak.
 *
 * This is I/O glue and nothing else: the catalogue is read by
 * `providers/catalog`, the `.env` files by `environment-files`, and what any of it
 * *means* -- precedence, typing, validation -- is the core's
 * (`core/config/resolver`), which receives the contents as parameters.
 */

import { homedir } from "node:os";
import { dirname } from "node:path";

import { type Config, type ConfigField, type RegisteredProviders } from "../../core/config/config";
import { type ConfigSources, resolveConfig } from "../../core/config/resolver";
import { type Logger, NULL_LOGGER } from "../../core/ports/logger";
import { type Environment, configHome } from "../catalog/paths";
import { loadCatalog } from "../catalog/reader";

import { environmentFilePaths, readEnvironmentFile } from "./environment-files";

export interface LoadRunConfigOptions {
  readonly project?: string | null;
  readonly configFile?: string | null;
  readonly overrides?: Readonly<Partial<Record<ConfigField, unknown>>>;
  /** False for a flow that builds no language model (`--preview`). */
  readonly requiresModel?: boolean;
  /** The LLM providers registered for this run; `LLM_PROVIDER` must name one. */
  readonly providers: RegisteredProviders;
  readonly cpuCount: number | null;
  readonly environment?: Environment;
  readonly cwd?: string;
  readonly home?: string;
  readonly logger?: Logger;
}

/**
 * Resolve one run's configuration from the disk and the environment: the
 * command line, the environment (real and `.env`), the catalogue project, and
 * the defaults, in that order of precedence.
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
    // Where the catalogue actually is -- a repository's `.review/` or the
    // machine's home -- so every relative path it names is taken from there.
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
