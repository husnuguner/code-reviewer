/**
 * Where configuration lives: the repository's `.review/`, found like `git` finds `.git`, else the
 * machine's `~/.config/reviewer`.
 * @packageDocumentation
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

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

/** Expands `~` and `~/x` to the home directory. */
export function expandUser(path: string, home: string = homedir()): string {
  if (path === "~") return home;
  return path.startsWith("~/") ? join(home, path.slice(2)) : path;
}

/** The machine's config home: `$XDG_CONFIG_HOME/reviewer`, else `~/.config/reviewer`. */
export function configHome(
  environment: Environment = process.env,
  home: string = homedir(),
): string {
  const xdg = (environment["XDG_CONFIG_HOME"] ?? "").trim();
  const base = xdg === "" ? join(home, ".config") : resolve(expandUser(xdg, home));
  return join(base, APP_DIR);
}

/**
 * The nearest `.review/config.yaml` at or above `cwd`.
 *
 * @returns The path, or `null`. Stops at the filesystem root; never consults the home directory.
 */
export function findRepoConfig(
  cwd: string = process.cwd(),
  isPresent: (path: string) => boolean = existsSync,
): string | null {
  let directory = resolve(cwd);
  for (;;) {
    const candidate = join(directory, REPO_CONFIG_DIR, CONFIG_FILENAME);
    if (isPresent(candidate)) return candidate;
    const parent = dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

/** The root of the git repository containing `cwd`, or `null` outside one. */
export function findGitRoot(
  cwd: string = process.cwd(),
  isPresent: (path: string) => boolean = existsSync,
): string | null {
  let directory = resolve(cwd);
  for (;;) {
    if (isPresent(join(directory, ".git"))) return directory;
    const parent = dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
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
 * @param isPresent - Existence check; when the YAML file is absent and a legacy `config.json` exists, that is named.
 * @returns `--config` › `REVIEWER_CONFIG` › the repository's `.review/config.yaml` › the config home's.
 */
export function configPath(
  explicit: string | null | undefined,
  environment: Environment = process.env,
  home: string = homedir(),
  isPresent: (path: string) => boolean = () => true,
  cwd: string = process.cwd(),
): string {
  if (explicit !== null && explicit !== undefined && explicit !== "") {
    return resolve(expandUser(explicit, home));
  }
  const fromEnvironment = (environment[ENV_OVERRIDE] ?? "").trim();
  if (fromEnvironment !== "") return resolve(expandUser(fromEnvironment, home));
  const inRepo = findRepoConfig(cwd, isPresent);
  if (inRepo !== null) return inRepo;
  const directory = configHome(environment, home);
  const preferred = join(directory, CONFIG_FILENAME);
  const legacy = join(directory, LEGACY_CONFIG_FILENAME);
  return !isPresent(preferred) && isPresent(legacy) ? legacy : preferred;
}
