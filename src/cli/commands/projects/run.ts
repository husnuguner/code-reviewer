/**
 * `reviewer projects`: lists what the catalogue defines, or says where one was expected.
 * @packageDocumentation
 */

import { listProjects } from "../../../core/catalog/list-projects";
import { loadCatalog } from "../../../providers/catalog/reader";
import { type CatalogArguments, catalogCradle } from "../../options/catalog";

/** Runs `projects`; returns the exit code. */
export function runProjects(arguments_: CatalogArguments): number {
  const { catalogPath, console: out, logger } = catalogCradle(arguments_);
  return listProjects(loadCatalog(arguments_.config, process.env, logger), catalogPath, out);
}
