/**
 * The text files this package ships: the three prompt files (not replaceable) and the templates `init`
 * writes. Located from the package's own `package.json`, so a global install and a checkout agree.
 * @packageDocumentation
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ConfigError } from "../../core/config/config";

const PACKAGE_NAME = "code-reviewer";

/**
 * The directory holding this package's `package.json`.
 *
 * @throws {@link ConfigError} when it cannot be found by walking up.
 */
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

/** A shipped file, by package-relative path. */
export type ShippedFile =
  /** The review policy. */
  | "prompts/system.md"
  /** The JSON output contract. */
  | "prompts/output-contract.md"
  /** The verification policy. */
  | "prompts/verify.md"
  /** The machine's config file `init` writes outside a repository. */
  | "templates/config.yaml"
  /** The `.review/config.yaml` `init` writes inside one. */
  | "templates/repo-config.yaml"
  /** The README written into `.review/skills/`. */
  | "templates/skills-README.md";

/** Reads one shipped text file. */
export function shippedFile(name: ShippedFile): string {
  return readFileSync(join(packageRoot(), name), "utf8");
}
