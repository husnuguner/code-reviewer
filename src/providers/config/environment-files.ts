/**
 * The `.env` files a run reads. Strongest first: the one beside the repository config file in force
 * (`.review/.env`), then the machine's `~/.config/reviewer/.env`. Read as a layer, never exported.
 *
 * The working directory's `.env` is not among them: the working directory is the checkout under review,
 * and its `.env` is that application's, or a change's -- a file a pull request can add. A variable read from
 * there could name the endpoint the model's key is sent to.
 * @packageDocumentation
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseEnv } from "node:util";

import { ENV_FILENAME, type Environment, configHome } from "./paths";

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

/**
 * The `.env` paths the run reads, lowest precedence first.
 *
 * @param repoConfig - The repository config file in force (`configPaths(...).repo`), or `null`. Its `.env` is
 * read from beside it, not found by a walk-up: when CI names the base branch's policy with `--config`, the
 * pull request's own `.review/.env` is part of the change under review, not of the policy.
 */
export function environmentFilePaths(
  repoConfig: string | null,
  environment: Environment = process.env,
): string[] {
  return [
    join(configHome(environment), ENV_FILENAME),
    ...(repoConfig === null ? [] : [join(dirname(repoConfig), ENV_FILENAME)]),
  ];
}
