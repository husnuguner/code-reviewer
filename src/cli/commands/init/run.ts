/**
 * `reviewer init`: what it does.
 *
 * Decide which home the catalogue gets, hand the core use-case a file store
 * and the shipped starter files, and let it write. The two homes get
 * different starters: a repository holds one project and already knows where
 * it is; a machine holds many and has to be told.
 */

import { initCatalog } from "../../../core/catalog/init";
import { shippedFile } from "../../../providers/assets/shipped-files";
import { FsCatalogFiles } from "../../../providers/catalog/files";
import { findGitRoot, repoConfigPath } from "../../../providers/catalog/paths";
import { type CatalogArguments, catalogCradle } from "../../options/catalog";

export function runInit(arguments_: CatalogArguments): number {
  const { catalogPath, configHomePath, console: out } = catalogCradle(arguments_);
  const gitRoot = arguments_.config === null ? findGitRoot() : null;
  const target = gitRoot === null ? catalogPath : repoConfigPath(gitRoot);
  const files = new FsCatalogFiles(target, configHomePath);
  return initCatalog(files, out, {
    catalog: shippedFile(
      files.home === "repo" ? "templates/repo-config.yaml" : "templates/config.yaml",
    ),
    policy: shippedFile("prompts/system.md"),
    skillsReadme: shippedFile("templates/skills-README.md"),
  });
}
