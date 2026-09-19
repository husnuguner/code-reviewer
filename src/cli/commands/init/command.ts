/**
 * `reviewer init`: the catalogue flags alone. Touches no model and no hosting system.
 * @packageDocumentation
 */

import { CatalogError } from "../../../core/util/errors";
import { defineCommand, instanceOfAny } from "../../command-line";
import { type CatalogArguments, catalogArguments, catalogOptions } from "../../options/catalog";

import { runInit } from "./run";

/** `reviewer init`, as the root registers it. */
export const INIT = defineCommand<CatalogArguments>({
  name: "init",
  description:
    "Write a starter config.yaml: inside a git checkout its own .review/, otherwise the machine-wide catalogue.",
  options: catalogOptions,
  arguments: catalogArguments,
  run: runInit,
  isOperatorError: instanceOfAny(CatalogError),
});
