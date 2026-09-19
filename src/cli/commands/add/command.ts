/**
 * `reviewer add <name>`: its flags and their parsed shape.
 * @packageDocumentation
 */

import { type Command } from "commander";

import { CatalogError } from "../../../core/util/errors";
import { type ParsedOptions, defineCommand, instanceOfAny } from "../../command-line";
import { type CatalogArguments, catalogArguments, catalogOptions } from "../../options/catalog";

import { runAdd } from "./run";

/** Where a new project's skills are read from unless told otherwise: inside the repository, so CI can read them. */
export const DEFAULT_REPO_SKILLS = ".review/skills";

/** The parsed `add` command line. */
export interface AddArguments extends CatalogArguments {
  /** The project to define. */
  readonly name: string;
  /** `--path`: the checkout; `null` means the current directory. */
  readonly path: string | null;
  /** `--skills`: where the project's skills come from. */
  readonly skills: string;
}

/** `reviewer add`, as the root registers it. The name is a positional, so the options are the flags alone. */
export const ADD = defineCommand<AddArguments, ParsedOptions<Omit<AddArguments, "name">>>({
  name: "add",
  description: "Define a project in the catalogue.",
  options: (command: Command) =>
    catalogOptions(command)
      .argument("<name>", "The project's name.")
      .option("--path <dir>", "The checkout the project reviews (default: the current directory).")
      .option(
        "--skills <path>",
        `Where the project's skills are read from. A path inside the reviewed repository (default '${DEFAULT_REPO_SKILLS}') travels with the code and works in CI; an absolute or ~ path is a directory on this machine only.`,
        DEFAULT_REPO_SKILLS,
      ),
  arguments: (options, [name]) => ({
    ...catalogArguments(options),
    name: name ?? "",
    path: options.path ?? null,
    skills: options.skills,
  }),
  run: runAdd,
  isOperatorError: instanceOfAny(CatalogError),
});
