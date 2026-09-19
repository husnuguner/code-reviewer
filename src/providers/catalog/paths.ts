/**
 * Where configuration lives: the repository's `.review/`, found by walking up from the working
 * directory the way `git` finds `.git`, else the machine's `~/.config/reviewer`.
 * @packageDocumentation
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

import { findUpSync } from "find-up";
import untildify from "untildify";

const ENV_OVERRIDE = "REVIEWER_CONFIG";
const APP_DIR = "reviewer";
/** The directory a repository keeps its review configuration in. */
export const REPO_CONFIG_DIR = ".review";
/** The catalogue's file name. */
export const CONFIG_FILENAME = "config.yaml";
/** The pre-YAML name; still read when the YAML one is absent. */
const LEGACY_CONFIG_FILENAME = "config.json";
/** The secrets file beside a catalogue. */
export const ENV_FILENAME = ".env";

/** An environment map. */
export type Environment = Readonly<Record<string, string | undefined>>;

/** Expands a leading `~` to the home directory. */
export function expandUser(path: string): string {
  return untildify(path);
}

/**
 * The machine's config home: `$XDG_CONFIG_HOME/reviewer`, else `~/.config/reviewer`.
 *
 * @remarks Not `xdg-basedir`: it fixes `$XDG_CONFIG_HOME` at import, and the loader's tests redirect
 * the config home through `environment` to keep off the developer's real `~/.config/reviewer/.env`.
 */
export function configHome(environment: Environment = process.env): string {
  const xdg = (environment["XDG_CONFIG_HOME"] ?? "").trim();
  const base = xdg === "" ? join(homedir(), ".config") : resolve(expandUser(xdg));
  return join(base, APP_DIR);
}

/**
 * The nearest `.review/config.yaml` at or above `cwd`.
 *
 * @returns The path, or `null`. Stops at the filesystem root; never consults the home directory.
 */
export function findRepoConfig(cwd: string = process.cwd()): string | null {
  return findUpSync(join(REPO_CONFIG_DIR, CONFIG_FILENAME), { cwd, type: "file" }) ?? null;
}

/** The root of the git repository containing `cwd`, or `null` outside one. */
export function findGitRoot(cwd: string = process.cwd()): string | null {
  // `.git` is a file in a worktree or submodule, hence `both`.
  const marker = findUpSync(".git", { cwd, type: "both" });
  return marker === undefined ? null : dirname(marker);
}

/** `<repo>/.review/config.yaml`. */
export function repoConfigPath(repoRoot: string): string {
  return join(repoRoot, REPO_CONFIG_DIR, CONFIG_FILENAME);
}

/** Whether a catalogue path is a repository's own. */
export function isRepoConfig(path: string): boolean {
  return basename(dirname(path)) === REPO_CONFIG_DIR;
}

/** The repository a repo-local catalogue belongs to: the parent of `.review/`. */
export function repoRootOf(configFile: string): string {
  return dirname(dirname(configFile));
}

/**
 * Where the catalogue is expected.
 *
 * @param explicit - `--config`.
 * @returns `--config` › `REVIEWER_CONFIG` › the repository's `.review/config.yaml` › the config home's;
 * there, a legacy `config.json` is named when it exists and the YAML file does not.
 */
export function configPath(
  explicit: string | null | undefined,
  environment: Environment = process.env,
  cwd: string = process.cwd(),
): string {
  if (explicit !== null && explicit !== undefined && explicit !== "") {
    return resolve(expandUser(explicit));
  }
  const fromEnvironment = (environment[ENV_OVERRIDE] ?? "").trim();
  if (fromEnvironment !== "") return resolve(expandUser(fromEnvironment));
  const inRepo = findRepoConfig(cwd);
  if (inRepo !== null) return inRepo;
  const directory = configHome(environment);
  const preferred = join(directory, CONFIG_FILENAME);
  const legacy = join(directory, LEGACY_CONFIG_FILENAME);
  return !existsSync(preferred) && existsSync(legacy) ? legacy : preferred;
}
