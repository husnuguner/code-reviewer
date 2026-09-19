/**
 * `reviewer add <name>`: checks the inputs and hands the core use-case a file store.
 * @packageDocumentation
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { addProject } from "../../../core/catalog/add-project";
import { type CatalogFiles } from "../../../core/ports/catalog-files";
import { CatalogError } from "../../../core/util/errors";
import { FsCatalogFiles } from "../../../providers/catalog/files";
import { expandUser } from "../../../providers/catalog/paths";
import { loadCatalog } from "../../../providers/catalog/reader";
import { isLocalSkillsPath } from "../../../providers/skills/sources";
import { UsageError } from "../../command-line";
import { catalogCradle } from "../../options/catalog";

import { type AddArguments } from "./command";

/**
 * Runs `add`.
 *
 * @returns The exit code.
 * @throws {@link UsageError} without a name; {@link CatalogError} when `--path` does not exist.
 */
export function runAdd(arguments_: AddArguments): number {
  const { catalogPath, configHomePath, console: out, logger } = catalogCradle(arguments_);
  const files: CatalogFiles = new FsCatalogFiles(catalogPath, configHomePath);
  const name = arguments_.name.trim();
  if (name === "") {
    throw new UsageError("add needs a project name: reviewer add <name> [--path <dir>]", 1);
  }
  const localPath = resolve(expandUser(arguments_.path ?? process.cwd()));
  if (!existsSync(localPath)) {
    throw new CatalogError(`${localPath} does not exist; --path must name a checkout.`);
  }
  const skills = arguments_.skills.trim();
  return addProject(loadCatalog(arguments_.config, process.env, logger), files, out, {
    name,
    localPath,
    // A local (absolute or `~`) path means the machine's per-project directory; empty disables skills.
    skillsPath: skills === "" || isLocalSkillsPath(skills) ? null : skills,
  });
}
