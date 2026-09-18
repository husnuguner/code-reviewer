/** `reviewer add <name>`: what it does -- check the inputs, hand the core use-case a file store. */

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
    // An absolute or ~ path is a directory on this machine; anything else is
    // read from inside the reviewed repository. Empty disables skills.
    skillsPath: skills === "" || isLocalSkillsPath(skills) ? null : skills,
  });
}
