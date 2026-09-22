/**
 * Where configuration lives: the machine's `~/.config/reviewer`, and the repository's `.review/`, found by
 * walking up from the working directory the way `git` finds `.git`.
 * @packageDocumentation
 */

import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { findUpSync } from "find-up";
import untildify from "untildify";

const ENV_OVERRIDE = "REVIEWER_CONFIG";
const APP_DIR = "reviewer";
/** The directory a repository keeps its review configuration in. */
export const REPO_CONFIG_DIR = ".review";
/** The config file's name, in both homes. */
export const CONFIG_FILENAME = "config.yaml";
/** The secrets file beside a config file. */
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

/** `~/.config/reviewer/config.yaml`. */
export function machineConfigPath(environment: Environment = process.env): string {
  return join(configHome(environment), CONFIG_FILENAME);
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

/** Whether a config path is a repository's own. */
export function isRepoConfig(path: string): boolean {
  return basename(dirname(path)) === REPO_CONFIG_DIR;
}

/** The repository a repo-local config file belongs to: the parent of `.review/`. */
export function repoRootOf(configFile: string): string {
  return dirname(dirname(configFile));
}

/**
 * `path` as the checkout spells it, forward slashes, or `null` when it lies outside `root`.
 *
 * @remarks `root` itself reads as `null` too: a directory is inside the checkout, the checkout is not inside itself.
 */
export function insideCheckout(root: string, path: string): string | null {
  const below = relative(resolve(root), resolve(path));
  return below === "" || below.startsWith("..") || isAbsolute(below)
    ? null
    : below.split(sep).join("/");
}

/** The two config files a run reads: the repository's on top of the machine's. */
export interface ConfigPaths {
  /** The machine's file; always a path, whether or not the file exists. */
  readonly machine: string;
  /** The repository's file, or `null` when the run is not inside a checkout that carries one. */
  readonly repo: string | null;
  /** Whether `repo` was named by hand (`--config`, `REVIEWER_CONFIG`), so its absence is an error. */
  readonly isRepoNamed: boolean;
}

/**
 * Where the config files are expected.
 *
 * @param explicit - `--config`.
 * @returns The machine's path, and for the repository slot: `--config` › `REVIEWER_CONFIG` › the nearest
 * `.review/config.yaml` › `null`.
 */
export function configPaths(
  explicit: string | null | undefined,
  environment: Environment = process.env,
  cwd: string = process.cwd(),
): ConfigPaths {
  const machine = machineConfigPath(environment);
  const named =
    explicit !== null && explicit !== undefined && explicit !== ""
      ? explicit
      : (environment[ENV_OVERRIDE] ?? "").trim();
  return named === ""
    ? { machine, repo: findRepoConfig(cwd), isRepoNamed: false }
    : { machine, repo: resolve(expandUser(named)), isRepoNamed: true };
}
