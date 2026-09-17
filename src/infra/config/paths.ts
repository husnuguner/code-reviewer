/**
 * Where configuration lives on this machine.
 *
 * Deliberately not derived from the package's own location: the reviewer is
 * invoked from inside whichever repository is being reviewed, so anything
 * relative to the installation would be unreachable from there.
 */

import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { pyStrip } from "../../core/util/py";

const ENV_OVERRIDE = "REVIEWER_CONFIG";
const APP_DIR = "reviewer";
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
 * The directory holding `config.json` and its sibling `.env`. Honours
 * `XDG_CONFIG_HOME` and falls back to `~/.config`.
 */
export function configHome(
  environment: Environment = process.env,
  home: string = homedir(),
): string {
  const xdg = pyStrip(environment["XDG_CONFIG_HOME"] ?? "");
  const base = xdg === "" ? join(home, ".config") : resolve(expandUser(xdg, home));
  return join(base, APP_DIR);
}

/**
 * Where the catalogue is expected, in precedence order: `--config` beats
 * `REVIEWER_CONFIG` beats `config.yaml` in the config home. A short, fixed
 * chain on purpose: a longer search would make "which file did this setting
 * come from?" a question nobody can answer from the outside. The one
 * concession is `isPresent`: when the YAML file is absent and a `config.json`
 * from before the format change is there, that one is named instead (YAML
 * reads JSON), so an upgrade does not silently lose the catalogue.
 */
export function configPath(
  explicit: string | null | undefined,
  environment: Environment = process.env,
  home: string = homedir(),
  isPresent: (path: string) => boolean = () => true,
): string {
  if (explicit !== null && explicit !== undefined && explicit !== "") {
    return resolve(expandUser(explicit, home));
  }
  const fromEnvironment = pyStrip(environment[ENV_OVERRIDE] ?? "");
  if (fromEnvironment !== "") return resolve(expandUser(fromEnvironment, home));
  const directory = configHome(environment, home);
  const preferred = join(directory, CONFIG_FILENAME);
  const legacy = join(directory, LEGACY_CONFIG_FILENAME);
  return !isPresent(preferred) && isPresent(legacy) ? legacy : preferred;
}
