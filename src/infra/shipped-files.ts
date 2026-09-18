/**
 * The text files this package ships -- prose belongs in files, not in code.
 *
 * `prompts/system.md` is the review policy, the half of the system prompt an
 * operator may replace (see `defaults.prompts`); `prompts/output-contract.md`
 * is the half the core owns, and `prompts/verify.md` is the verification
 * policy -- core-owned too, because its asymmetry rule and its vetoes are
 * what keep a second pass from deleting real findings.
 * `templates/config.yaml` is the catalogue `reviewer init` writes. All are
 * located from this module's own position, walking up to the `package.json`
 * that names this package, so a global install and a checkout find the same
 * files.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ConfigError } from "../core/config/config";

const PACKAGE_NAME = "code-reviewer";

/** The directory holding this package's `package.json`. */
function packageRoot(): string {
  let directory = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const manifest = join(directory, "package.json");
    if (existsSync(manifest) && isThisPackage(manifest)) return directory;
    const parent = dirname(directory);
    if (parent === directory) {
      throw new ConfigError(
        `Cannot locate the ${PACKAGE_NAME} package root from ${import.meta.url}.`,
      );
    }
    directory = parent;
  }
}

function isThisPackage(manifest: string): boolean {
  try {
    const parsed = JSON.parse(readFileSync(manifest, "utf8")) as { name?: unknown };
    return parsed.name === PACKAGE_NAME;
  } catch {
    return false;
  }
}

export type ShippedFile =
  | "prompts/system.md"
  | "prompts/output-contract.md"
  | "prompts/verify.md"
  /** The machine-wide catalogue `reviewer init` writes outside a repository. */
  | "templates/config.yaml"
  /** The repository's own `.review/config.yaml`, written by `init` inside one. */
  | "templates/repo-config.yaml"
  /** What a skill is, for whoever opens `.review/skills/` first. */
  | "templates/skills-README.md";

/** One shipped text file, by its package-relative path. */
export function shippedFile(name: ShippedFile): string {
  return readFileSync(join(packageRoot(), name), "utf8");
}
