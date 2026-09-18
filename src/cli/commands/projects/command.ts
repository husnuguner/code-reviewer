/** `reviewer projects`: what it takes -- the catalogue flags alone. */

import { CatalogError } from "../../../core/util/errors";
import { defineCommand, instanceOfAny } from "../../command-line";
import { type CatalogArguments, catalogArguments, catalogOptions } from "../../options/catalog";

import { runProjects } from "./run";

export const PROJECTS = defineCommand<CatalogArguments>({
  name: "projects",
  description: "List the projects the catalogue defines.",
  options: catalogOptions,
  arguments: catalogArguments,
  run: runProjects,
  // A catalogue that cannot be read is the operator's to fix.
  isOperatorError: instanceOfAny(CatalogError),
});
