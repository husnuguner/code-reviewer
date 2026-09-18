/**
 * `reviewer add <name>`: what it takes.
 *
 * The checkout defaults to the current directory, because the natural way to
 * run this is from inside the repository being added. `--skills` defaults to
 * a path *inside* that repository, so the rules are versioned with the code
 * they govern and CI can read them.
 */

import { type Command } from "commander";

import { CatalogError } from "../../../core/util/errors";
import { type ParsedOptions, defineCommand, instanceOfAny } from "../../command-line";
import { type CatalogArguments, catalogArguments, catalogOptions } from "../../options/catalog";

import { runAdd } from "./run";

/**
 * Where a newly added project's skills are read from, unless told otherwise.
 *
 * Inside the reviewed repository, because that is the only home that works
 * everywhere: the rules travel with the code they govern, a change to a
 * convention can ship in the same pull request as the code that follows it,
 * and a CI runner -- which has no `~/.config/reviewer` -- can still read them.
 */
export const DEFAULT_REPO_SKILLS = ".review/skills";

/** `reviewer add <name>`'s arguments. */
export interface AddArguments extends CatalogArguments {
  /** The project to define. */
  readonly name: string;
  /** `--path`: the checkout the new project reviews. */
  readonly path: string | null;
  /** `--skills`: where the new project's skills come from. */
  readonly skills: string;
}

/** The name is a positional, so the options are the flags alone. */
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
  // A catalogue that cannot be read or written as asked is the operator's to fix.
  isOperatorError: instanceOfAny(CatalogError),
});
