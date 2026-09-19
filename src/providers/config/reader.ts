/**
 * Reads the config files off the disk: find, read, decode YAML, check the reviewer's policy, expand `${...}`.
 * What the values mean is convict's, in the core.
 * @packageDocumentation
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

import { parse as parseYaml } from "yaml";

import { type ConfigFile } from "../../core/config/config-file";
import { expandReferences } from "../../core/config/environment-reference";
import { parseConfigFile } from "../../core/config/parse";
import { type ConfigHome } from "../../core/ports/config-directory";
import { type Logger, NULL_LOGGER } from "../../core/ports/logger";
import { ConfigFileError, errorMessage } from "../../core/util/errors";
import { isPlainObject } from "../../core/util/json";

import { type ConfigPaths } from "./paths";

/** The config files a run found, lowest precedence first: the machine's, then the repository's. */
export type LoadedConfigFiles = readonly ConfigFile[];

/**
 * Loads both config files.
 *
 * @param paths - Where to look; a repository slot named by hand (`--config`, `REVIEWER_CONFIG`) must exist.
 * @param environment - The merged environment, for `${...}` in the files' values.
 * @returns The files that exist, the machine's before the repository's.
 * @throws {@link ConfigFileError} when an explicitly named file is missing, or a file is unreadable or invalid.
 */
export function loadConfigFiles(
  paths: ConfigPaths,
  environment: Readonly<Record<string, string | undefined>>,
  logger: Logger = NULL_LOGGER,
): LoadedConfigFiles {
  const log = logger.child("config");
  const machine = readConfigFile(paths.machine, "machine", false, log);
  const repo =
    paths.repo === null ? null : readConfigFile(paths.repo, "repo", paths.isRepoNamed, log);
  return [machine, repo]
    .filter((file): file is ConfigFile => file !== null)
    .map((file) =>
      withAnchoredSkillsPath({ ...file, values: expandReferences(file.values, environment) }),
    );
}

/** Whether a path names a place on its own: absolute, or under `~`. */
function isAnchored(path: string): boolean {
  return isAbsolute(path) || path === "~" || path.startsWith("~/");
}

/** A relative `skills.path` is taken from beside the file that set it: in `.review/config.yaml`, `skills` means `.review/skills`. */
function withAnchoredSkillsPath(file: ConfigFile): ConfigFile {
  const skills = file.values["skills"];
  if (!isPlainObject(skills) || typeof skills["path"] !== "string") return file;
  const path = skills["path"].trim();
  return path === "" || isAnchored(path)
    ? file
    : {
        ...file,
        values: {
          ...file.values,
          skills: { ...skills, path: resolve(dirname(file.source), path) },
        },
      };
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
  log.debug(`Read ${home} config file ${path}: ${Object.keys(file.values).length} key(s).`);
  return file;
}
