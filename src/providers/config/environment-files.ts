/**
 * The `.env` files a run reads. Strongest first: the repository's `.review/.env`, the machine's
 * `~/.config/reviewer/.env`, the working directory's `.env`. Read as a layer, never exported.
 * @packageDocumentation
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseEnv } from "node:util";

import { ENV_FILENAME, type Environment, configHome, findRepoConfig } from "./paths";

/** Name/value pairs from one source; names are matched case-insensitively. */
export type EnvironmentValues = Readonly<Record<string, string | undefined>>;

/** Whether an environment value counts as said; `""` does not. */
function isSet(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== "";
}

/**
 * The environment as one map: the `.env` files lowest first, the process environment on top, names uppercased,
 * empty values dropped.
 */
export function mergedEnvironment(
  processEnvironment: EnvironmentValues,
  environmentFiles: readonly EnvironmentValues[],
): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const source of [...environmentFiles, processEnvironment]) {
    for (const [name, value] of Object.entries(source)) {
      if (isSet(value)) merged[name.toUpperCase()] = value;
    }
  }
  return merged;
}

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
