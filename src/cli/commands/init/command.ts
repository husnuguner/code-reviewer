/**
 * `reviewer init`: the --config flag alone. Touches no model and no hosting system.
 * @packageDocumentation
 */

import { ConfigFileError } from "../../../core/util/errors";
import { defineCommand, instanceOfAny } from "../../command-line";
import { type ConfigArguments, configArguments, configOptions } from "../../options/config";

import { runInit } from "./run";

/** `reviewer init`, as the root registers it. */
export const INIT = defineCommand<ConfigArguments>({
  name: "init",
  description:
    "Write a starter config.yaml: inside a git checkout its own .review/ (what is reviewed there), otherwise the machine's ~/.config/reviewer/ (the model, once for every repository).",
  options: configOptions,
  arguments: configArguments,
  run: runInit,
  isOperatorError: instanceOfAny(ConfigFileError),
});
