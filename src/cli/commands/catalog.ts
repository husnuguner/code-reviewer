/**
 * The catalogue commands: `reviewer init`, `reviewer projects`,
 * `reviewer add <name>`.
 *
 * They write and read `config.yaml`; none of them touches a model or a
 * hosting system, so they run on a machine that has no credential at all.
 * The container is still what builds their collaborators -- resolution is
 * lazy, so asking it for the console, the paths and the logger costs nothing
 * else.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { type Command } from "commander";

import {
  type CatalogFiles,
  addProject,
  initCatalog,
  listProjects,
} from "../../core/catalog/commands";
import { CatalogError } from "../../core/util/errors";
import { FsCatalogFiles } from "../../infra/config/catalog-files";
import { loadCatalog } from "../../infra/config/loader";
import { expandUser, findGitRoot, repoConfigPath } from "../../infra/config/paths";
import { shippedFile } from "../../infra/shipped-files";
import { isLocalSkillsPath } from "../../infra/skills/sources";
import { type ParsedOptions, UsageError, defineCommand, instanceOfAny } from "../command-line";
import { type RunCradle, buildContainer } from "../container";

import { type CatalogArguments, catalogArguments, catalogOptions, catalogRequest } from "./shared";

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

/** The console, the paths and the logger, from the same root every command builds through. */
function catalogCradle(
  arguments_: CatalogArguments,
): Pick<RunCradle, "console" | "catalogPath" | "configHomePath" | "logger"> {
  return buildContainer(catalogRequest(arguments_)).cradle;
}

/**
 * A catalogue that cannot be read or written as asked is the operator's to
 * fix: the message names the file and the reason.
 */
const isCatalogOperatorError = instanceOfAny(CatalogError);

/**
 * `reviewer init`: write the review setup where it belongs.
 *
 * Inside a git checkout that is the checkout's own `.review/` -- committed,
 * shared with the team, readable by CI. Outside one (or with `--config`), it
 * is the machine-wide catalogue. The two get different starters: a
 * repository holds one project and already knows where it is; a machine
 * holds many and has to be told.
 */
function runInit(arguments_: CatalogArguments): number {
  const { catalogPath, configHomePath, console: out } = catalogCradle(arguments_);
  const gitRoot = arguments_.config === null ? findGitRoot() : null;
  const target = gitRoot === null ? catalogPath : repoConfigPath(gitRoot);
  const files = new FsCatalogFiles(target, configHomePath);
  return initCatalog(files, out, {
    catalog: shippedFile(
      files.home === "repo" ? "templates/repo-config.yaml" : "templates/config.yaml",
    ),
    policy: shippedFile("prompts/system.md"),
    skillsReadme: shippedFile("templates/skills-README.md"),
  });
}

/** `reviewer projects`: list what the catalogue defines, or say where one was expected. */
function runProjects(arguments_: CatalogArguments): number {
  const { catalogPath, console: out, logger } = catalogCradle(arguments_);
  return listProjects(loadCatalog(arguments_.config, process.env, logger), catalogPath, out);
}

/**
 * `reviewer add <name>`: define a project in the catalogue.
 *
 * The checkout defaults to the current directory, because the natural way to
 * run this is from inside the repository being added. `--skills` defaults to
 * a path *inside* that repository, so the rules are versioned with the code
 * they govern and CI can read them.
 */
function runAdd(arguments_: AddArguments): number {
  const { catalogPath, configHomePath, console: out, logger } = catalogCradle(arguments_);
  const files: CatalogFiles = new FsCatalogFiles(catalogPath, configHomePath);
  const name = arguments_.name.trim();
  if (name === "") {
    throw new UsageError("add needs a project name: reviewer add <name> [--path <dir>]", 1);
  }
  const localPath = resolve(expandUser(arguments_.path ?? process.cwd()));
  if (!existsSync(localPath)) {
    throw new CatalogError(`${localPath} does not exist; --path must name a checkout.`);
  }
  const skills = arguments_.skills.trim();
  return addProject(loadCatalog(arguments_.config, process.env, logger), files, out, {
    name,
    localPath,
    // An absolute or ~ path is a directory on this machine; anything else is
    // read from inside the reviewed repository. Empty disables skills.
    skillsPath: skills === "" || isLocalSkillsPath(skills) ? null : skills,
  });
}

/** `reviewer init`, as the root command registers it. */
export const INIT = defineCommand<CatalogArguments>({
  name: "init",
  description:
    "Write a starter config.yaml: inside a git checkout its own .review/, otherwise the machine-wide catalogue.",
  options: catalogOptions,
  arguments: catalogArguments,
  run: runInit,
  isOperatorError: isCatalogOperatorError,
});

/** `reviewer projects`. */
export const PROJECTS = defineCommand<CatalogArguments>({
  name: "projects",
  description: "List the projects the catalogue defines.",
  options: catalogOptions,
  arguments: catalogArguments,
  run: runProjects,
  isOperatorError: isCatalogOperatorError,
});

/** `reviewer add <name>`. The name is a positional, so the options are the flags alone. */
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
  isOperatorError: isCatalogOperatorError,
});
