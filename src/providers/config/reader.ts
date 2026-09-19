/**
 * Reads the config files off the disk: find, read, decode YAML, hand to the core to validate.
 * @packageDocumentation
 */

import { existsSync, readFileSync, statSync } from "node:fs";

import { parse as parseYaml } from "yaml";

import { type ConfigFile } from "../../core/config/config-file";
import { parseConfigFile } from "../../core/config/parse";
import { type ConfigHome } from "../../core/ports/config-directory";
import { type Logger, NULL_LOGGER } from "../../core/ports/logger";
import { ConfigFileError, errorMessage } from "../../core/util/errors";

import { type ConfigPaths } from "./paths";

/** The config files a run found: either may be absent. */
export interface LoadedConfigFiles {
  readonly machine: ConfigFile | null;
  readonly repo: ConfigFile | null;
}

/**
 * Loads both config files.
 *
 * @param paths - Where to look; a repository slot named by hand (`--config`, `REVIEWER_CONFIG`) must exist.
 * @returns The files, each `null` when there is none.
 * @throws {@link ConfigFileError} when an explicitly named file is missing, or a file is unreadable or invalid.
 */
export function loadConfigFiles(
  paths: ConfigPaths,
  logger: Logger = NULL_LOGGER,
): LoadedConfigFiles {
  const log = logger.child("config");
  const machine = readConfigFile(paths.machine, "machine", false, log);
  const repo =
    paths.repo === null ? null : readConfigFile(paths.repo, "repo", paths.isRepoNamed, log);
  return { machine, repo };
}

/** Reads one file, or `null` when it is absent and was not named by hand. */
function readConfigFile(
  path: string,
  home: ConfigHome,
  isNamed: boolean,
  log: Logger,
): ConfigFile | null {
  if (!existsSync(path) || !statSync(path).isFile()) {
    if (isNamed) throw new ConfigFileError(`No config file at ${path}`);
    log.debug(`No ${home} config file at ${path}.`);
    return null;
  }
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    throw new ConfigFileError(`Could not read ${path}: ${errorMessage(error)}`);
  }
  let payload: unknown;
  try {
    payload = parseYaml(text);
  } catch (error) {
    throw new ConfigFileError(`${path} is not valid YAML: ${errorMessage(error)}`);
  }
  const file = parseConfigFile(payload, path, home);
  log.debug(`Read ${home} config file ${path}: ${Object.keys(file.values).length} setting(s).`);
  return file;
}
