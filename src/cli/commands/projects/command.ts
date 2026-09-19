/**
 * `reviewer projects`: the catalogue flags alone.
 * @packageDocumentation
 */

import { CatalogError } from "../../../core/util/errors";
import { defineCommand, instanceOfAny } from "../../command-line";
import { type CatalogArguments, catalogArguments, catalogOptions } from "../../options/catalog";

import { runProjects } from "./run";

/** `reviewer projects`, as the root registers it. */
export const PROJECTS = defineCommand<CatalogArguments>({
  name: "projects",
  description: "List the projects the catalogue defines.",
  options: catalogOptions,
  arguments: catalogArguments,
  run: runProjects,
  isOperatorError: instanceOfAny(CatalogError),
});
