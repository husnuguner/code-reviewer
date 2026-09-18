/** `reviewer projects`: list what the catalogue defines, or say where one was expected. */

import { listProjects } from "../../../core/catalog/list-projects";
import { loadCatalog } from "../../../providers/catalog/reader";
import { type CatalogArguments, catalogCradle } from "../../options/catalog";

export function runProjects(arguments_: CatalogArguments): number {
  const { catalogPath, console: out, logger } = catalogCradle(arguments_);
  return listProjects(loadCatalog(arguments_.config, process.env, logger), catalogPath, out);
}
