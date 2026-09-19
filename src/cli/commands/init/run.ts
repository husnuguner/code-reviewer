/**
 * `reviewer init`: decides which home the catalogue gets and hands the core use-case the shipped starters.
 * @packageDocumentation
 */

import { initCatalog } from "../../../core/catalog/init";
import { shippedFile } from "../../../providers/assets/shipped-files";
import { FsCatalogFiles } from "../../../providers/catalog/files";
import { findGitRoot, repoConfigPath } from "../../../providers/catalog/paths";
import { type CatalogArguments, catalogCradle } from "../../options/catalog";

/**
 * Runs `init`.
 *
 * @returns The exit code. Inside a checkout (and without `--config`) the target is its `.review/`.
 */
export function runInit(arguments_: CatalogArguments): number {
  const { catalogPath, configHomePath, console: out } = catalogCradle(arguments_);
  const gitRoot = arguments_.config === null ? findGitRoot() : null;
  const target = gitRoot === null ? catalogPath : repoConfigPath(gitRoot);
  const files = new FsCatalogFiles(target, configHomePath);
  return initCatalog(files, out, {
    catalog: shippedFile(
      files.home === "repo" ? "templates/repo-config.yaml" : "templates/config.yaml",
    ),
    skillsReadme: shippedFile("templates/skills-README.md"),
  });
}
