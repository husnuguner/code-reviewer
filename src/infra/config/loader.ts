/**
 * Reading configuration off the disk: the catalogue and the `.env` files.
 *
 * Everything here is I/O; what the files *mean* is decided by the pure
 * modules in `core/catalog` and `core/config`, which receive the contents as
 * parameters. A missing catalogue is not an error (a run may proceed on the
 * environment alone); an unreadable or invalid one is, because it states an
 * intent that cannot be honoured.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { parse as parseDotenv } from "dotenv";
import { parse as parseYaml } from "yaml";

import { type Catalog, parseCatalog } from "../../core/catalog/catalog";
import { type Config, type ConfigField } from "../../core/config/config";
import {
  type ConfigSources,
  type EnvironmentValues,
  resolveConfig,
} from "../../core/config/resolver";
import { type Logger, NULL_LOGGER } from "../../core/ports/logger";
import { CatalogError, errorMessage } from "../../core/util/errors";

import { ENV_FILENAME, type Environment, configHome, configPath, findRepoConfig } from "./paths";

/**
 * Read the catalogue, or `null` when there is no file to read.
 *
 * An explicitly named file that is missing *is* an error: the operator said
 * where to look.
 */
export function loadCatalog(
  explicit: string | null | undefined,
  environment: Environment = process.env,
  logger: Logger = NULL_LOGGER,
  home: string = homedir(),
  cwd: string = process.cwd(),
): Catalog | null {
  const log = logger.child("catalog");
  const path = configPath(explicit, environment, home, existsSync, cwd);
  if (!existsSync(path) || !statSync(path).isFile()) {
    if (explicit !== null && explicit !== undefined && explicit !== "") {
      throw new CatalogError(`No config file at ${path}`);
    }
    log.debug(`No project catalogue at ${path}; using the environment alone.`);
    return null;
  }
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    const detail = errorMessage(error);
    throw new CatalogError(`Could not read ${path}: ${detail}`);
  }
  let payload: unknown;
  try {
    // YAML 1.2 reads JSON as well, so a file from before the format change loads.
    payload = parseYaml(text);
  } catch (error) {
    throw new CatalogError(`${path} is not valid YAML: ${errorMessage(error)}`);
  }
  const catalog = parseCatalog(payload, path);
  log.debug(`Catalogue ${path}: ${catalog.projects.size} project(s).`);
  return catalog;
}

/** One `.env` file's name/value pairs, or nothing when it cannot be read. */
function readEnvironmentFile(path: string): EnvironmentValues {
  try {
    return parseDotenv(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

/**
 * The `.env` files the run reads, lowest precedence first.
 *
 * Three homes for secrets, and the order says which wins. The working
 * directory's `.env` is the weakest: it is whatever the checkout happens to
 * carry. The machine's `~/.config/reviewer/.env` is where a key normally
 * lives -- one place, `chmod 600`, reachable from every repository. The
 * repository's own `.review/.env` (gitignored by `init`) is strongest, so a
 * key meant for one project beats the machine's default for that project.
 */
function environmentFilePaths(
  environment: Environment = process.env,
  cwd: string = process.cwd(),
  home: string = homedir(),
): string[] {
  const repoConfig = findRepoConfig(cwd);
  return [
    join(cwd, ENV_FILENAME),
    join(configHome(environment, home), ENV_FILENAME),
    ...(repoConfig === null ? [] : [join(dirname(repoConfig), ENV_FILENAME)]),
  ];
}

export interface LoadRunConfigOptions {
  readonly project?: string | null;
  readonly configFile?: string | null;
  readonly overrides?: Readonly<Partial<Record<ConfigField, unknown>>>;
  /** False for a flow that builds no language model (`--preview`). */
  readonly requiresModel?: boolean;
  readonly providerNames: readonly string[];
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
    providerNames: options.providerNames,
    cpuCount: options.cpuCount,
    logger,
  });
}
