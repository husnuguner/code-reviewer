/**
 * The `.env` files a run reads. Strongest first: the repository's `.review/.env`, the machine's
 * `~/.config/reviewer/.env`, the working directory's `.env`. Read as a layer, never exported.
 * @packageDocumentation
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseEnv } from "node:util";

import { type EnvironmentValues } from "../../core/config/resolver";

import { ENV_FILENAME, type Environment, configHome, findRepoConfig } from "./paths";

/** One `.env` file's pairs, or `{}` when it cannot be read. */
export function readEnvironmentFile(path: string): EnvironmentValues {
  try {
    return parseEnv(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

/** The `.env` paths the run reads, lowest precedence first. */
export function environmentFilePaths(
  environment: Environment = process.env,
  cwd: string = process.cwd(),
): string[] {
  const repoConfig = findRepoConfig(cwd);
  return [
    join(cwd, ENV_FILENAME),
    join(configHome(environment), ENV_FILENAME),
    ...(repoConfig === null ? [] : [join(dirname(repoConfig), ENV_FILENAME)]),
  ];
}
