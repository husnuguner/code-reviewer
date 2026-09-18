/**
 * `reviewer init`: what it takes -- the catalogue flags alone.
 *
 * Writes the review setup where it belongs: inside a git checkout, the
 * checkout's own `.review/` (committed, shared with the team, readable by
 * CI); outside one, or with `--config`, the machine-wide catalogue. Touches
 * no model and no hosting system, so it runs on a machine with no credential.
 */

import { CatalogError } from "../../../core/util/errors";
import { defineCommand, instanceOfAny } from "../../command-line";
import { type CatalogArguments, catalogArguments, catalogOptions } from "../../options/catalog";

import { runInit } from "./run";

export const INIT = defineCommand<CatalogArguments>({
  name: "init",
  description:
    "Write a starter config.yaml: inside a git checkout its own .review/, otherwise the machine-wide catalogue.",
  options: catalogOptions,
  arguments: catalogArguments,
  run: runInit,
  // A catalogue that cannot be written as asked is the operator's to fix.
  isOperatorError: instanceOfAny(CatalogError),
});
