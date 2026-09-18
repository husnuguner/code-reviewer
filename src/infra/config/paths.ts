/**
 * Where configuration lives: inside the reviewed repository, or on this machine.
 *
 * Two homes, and the repository's own comes first. A project's rules -- its
 * skills, its review policy, which skill applies to which paths -- belong
 * with the code they govern: versioned with it, reviewed like it, and
 * readable by a CI runner that has no home directory worth speaking of. So
 * `reviewer` run inside a checkout looks for `.review/config.yaml` there
 * before it looks anywhere else. The machine-wide catalogue under
 * `~/.config/reviewer` remains for reviewing repositories that carry no rules
 * of their own, or for one person's rules that are not the team's.
 *
 * Deliberately not derived from the package's own location: the reviewer is
 * invoked from inside whichever repository is being reviewed, so anything
 * relative to the installation would be unreachable from there.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

const ENV_OVERRIDE = "REVIEWER_CONFIG";
const APP_DIR = "reviewer";
/** The directory a repository keeps its own review configuration in. */
export const REPO_CONFIG_DIR = ".review";
export const CONFIG_FILENAME = "config.yaml";
/** The name the file had before it was YAML; still read when the YAML one is absent. */
const LEGACY_CONFIG_FILENAME = "config.json";
export const ENV_FILENAME = ".env";

export type Environment = Readonly<Record<string, string | undefined>>;

/** `~` and `~/x` expand to the home directory, as `Path.expanduser()` does. */
export function expandUser(path: string, home: string = homedir()): string {
  if (path === "~") return home;
  return path.startsWith("~/") ? join(home, path.slice(2)) : path;
}

/**
 * The directory holding `config.yaml` and its sibling `.env`. Honours
 * `XDG_CONFIG_HOME` and falls back to `~/.config`.
 */
export function configHome(
  environment: Environment = process.env,
  home: string = homedir(),
): string {
  const xdg = (environment["XDG_CONFIG_HOME"] ?? "").trim();
  const base = xdg === "" ? join(home, ".config") : resolve(expandUser(xdg, home));
  return join(base, APP_DIR);
}

/**
 * The nearest `.review/config.yaml` at or above `cwd`, or `null`.
 *
 * Walks up like `git` finds `.git`, so the reviewer works from any
 * subdirectory of a checkout. It stops at the filesystem root and does not
 * consult the home directory: the machine-wide catalogue is a different home
 * with a different meaning, and finding it by accident here would blur the
 * two.
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

/**
 * The root of the git repository containing `cwd`, or `null` outside one.
 *
 * What `init` asks before deciding where to write: inside a checkout the
 * setup belongs to the checkout, and only outside one does it belong to the
 * machine.
 */
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

/** `<repo>/.review/config.yaml`: where a repository's own catalogue goes. */
export function repoConfigPath(repoRoot: string): string {
  return join(repoRoot, REPO_CONFIG_DIR, CONFIG_FILENAME);
}

/** Whether a catalogue path is a repository's own (`<repo>/.review/config.yaml`). */
export function isRepoConfig(path: string): boolean {
  return basename(dirname(path)) === REPO_CONFIG_DIR;
}

/** The repository a repo-local catalogue belongs to: the parent of `.review/`. */
export function repoRootOf(configFile: string): string {
  return dirname(dirname(configFile));
}

/**
 * Where the catalogue is expected, in precedence order: `--config` beats
 * `REVIEWER_CONFIG` beats the repository's own `.review/config.yaml` (found
 * from `cwd` upwards) beats `config.yaml` in the config home.
 *
 * The two explicit forms come first because they are the operator saying
 * "this one"; the repository's own comes before the machine's because the
 * rules that travel with the code are the rules that apply to it. A short,
 * fixed chain on purpose: a longer search would make "which file did this
 * setting come from?" a question nobody can answer from the outside. The one
 * concession is `isPresent`: when the YAML file is absent and a `config.json`
 * from before the format change is there, that one is named instead (YAML
 * reads JSON), so an upgrade does not silently lose the catalogue.
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
