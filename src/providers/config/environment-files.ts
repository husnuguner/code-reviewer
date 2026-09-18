/**
 * The `.env` files a run reads, and the order that decides which wins.
 *
 * Three homes for secrets. The working directory's `.env` is the weakest: it
 * is whatever the checkout happens to carry. The machine's
 * `~/.config/reviewer/.env` is where a key normally lives -- one place,
 * `chmod 600`, reachable from every repository. The repository's own
 * `.review/.env` (gitignored by `init`) is strongest, so a key meant for one
 * project beats the machine's default for that project.
 *
 * Read here, never exported: the values go to the resolver as a layer, so the
 * process environment is left as the operator set it.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { parseEnv } from "node:util";

import { type EnvironmentValues } from "../../core/config/resolver";
import { ENV_FILENAME, type Environment, configHome, findRepoConfig } from "../catalog/paths";

/** One `.env` file's name/value pairs, or nothing when it cannot be read. */
export function readEnvironmentFile(path: string): EnvironmentValues {
  try {
    return parseEnv(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

/** The `.env` files the run reads, lowest precedence first. */
export function environmentFilePaths(
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
