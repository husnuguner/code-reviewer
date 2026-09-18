/**
 * The two catalogue commands: scaffold one, and show what is in one.
 *
 * Both exist for one reason: the first run should be "run it, then edit it"
 * rather than "copy JSON out of a README". Neither reviews anything. Reading
 * and writing the file is injected, so the decisions here stay testable
 * without a disk.
 */

import { type ConsoleOutput } from "../ports/console";
import { countCodePoints, sortedByCodePoint } from "../util/text";

import { type Catalog } from "./catalog";

/**
 * Which home a catalogue is: a repository's own, or this machine's.
 *
 * The distinction decides what `init` writes and what it says. A repository's
 * `.review/` is committed and shared, so it gets a `.gitignore` for its
 * secret and a README for the team; the machine's `~/.config/reviewer` is
 * one person's, and gets neither.
 */
export type CatalogHome = "repo" | "machine";

/** Where the catalogue and its sibling files are written. */
export interface CatalogFiles {
  /** Where the catalogue goes (already resolved from `--config`/env/default). */
  readonly path: string;
  readonly home: CatalogHome;
  /** The directory holding the catalogue, for files that sit beside it. */
  readonly directory: string;
  /** The config home, for the hint about where the `.env` belongs. */
  readonly configHome: string;
  /** Where the review policy goes: `prompts/system.md` beside the catalogue. */
  readonly promptPath: string;
  exists(): boolean;
  /** Write the catalogue, creating parent directories. */
  write(text: string): void;
  promptExists(): boolean;
  /** Write the review policy, creating parent directories. */
  writePrompt(text: string): void;

  /**
   * Add one project to the catalogue, leaving every comment in place.
   *
   * Comment preservation is the requirement, not a nicety: this file is
   * hand-written and annotated, and a command that reformatted it on every
   * use would be a command nobody runs twice.
   */
  addProject(name: string, entry: Readonly<Record<string, unknown>>): void;

  /** Where a project's skills live on this machine, absolute. */
  skillsDirectory(project: string): string;

  /** Create that directory; `true` when it was not already there. */
  createSkillsDirectory(project: string): boolean;

  /** Write a file beside the catalogue (`relative` to its directory), creating parents. */
  writeSidecar(relative: string, text: string): void;

  sidecarExists(relative: string): boolean;
}

/**
 * Write a starter catalogue, refusing to overwrite an existing one.
 *
 * Refusing rather than merging: this file holds the operator's own project
 * definitions, and no scaffold is worth the chance of rewriting them.
 */

/** What `init` installs: a starter catalogue, the review policy, a skills README. */
export interface StarterFiles {
  readonly catalog: string;
  readonly policy: string;
  /** Explains, to whoever opens the skills folder, what a skill is. */
  readonly skillsReadme: string;
}

/**
 * Write the starter catalogue and, beside it, the shipped review policy the
 * starter's `defaults.prompts` points at -- so editing the policy is editing
 * a file the operator owns from day one. An existing policy file is kept.
 */
export function initCatalog(
  files: CatalogFiles,
  out: ConsoleOutput,
  starter: StarterFiles,
): number {
  if (files.exists()) {
    out.line(`${files.path} already exists; leaving it untouched.`);
    return 1;
  }
  files.write(starter.catalog);
  out.line(`Wrote ${files.path}`);
  if (files.promptExists()) {
    out.line(`Kept ${files.promptPath}`);
  } else {
    files.writePrompt(starter.policy);
    out.line(`Wrote ${files.promptPath}`);
  }
  return files.home === "repo"
    ? finishRepoInit(files, out, starter)
    : finishMachineInit(files, out);
}

/**
 * A repository's own `.review/`: everything the team and CI need, committed.
 *
 * The skills directory is created now, with a README, so the folder exists
 * to be found and the first person who opens it learns what goes there. The
 * `.gitignore` is not optional: `.review/.env` is where a project-specific
 * key may live, and a committed key is the one mistake `init` must make
 * impossible by default.
 */
function finishRepoInit(files: CatalogFiles, out: ConsoleOutput, starter: StarterFiles): number {
  if (!files.sidecarExists("skills/README.md")) {
    files.writeSidecar("skills/README.md", starter.skillsReadme);
    out.line(`Wrote ${files.directory}/skills/README.md`);
  }
  if (!files.sidecarExists(".gitignore")) {
    files.writeSidecar(
      ".gitignore",
      "# The model's key, if this project carries its own. Never commit it.\n.env\n",
    );
    out.line(`Wrote ${files.directory}/.gitignore`);
  }
  out.line();
  out.line(
    "This repository now carries its own review setup. Commit .review/ so the team and CI share it.",
  );
  out.line();
  out.line("Next:");
  out.line(
    `  1. Put the model's key in ~/.config/reviewer/.env (or ${files.directory}/.env, gitignored).`,
  );
  out.line(
    `  2. Add this project's review skills to ${files.directory}/skills/ -- see the README there.`,
  );
  out.line(`  3. Map each skill to the paths it reviews: skills.mappings in ${files.path}.`);
  out.line("  4. reviewer --preview --base main    # what would be reviewed; no model call");
  out.line("  5. reviewer --base main");
  return 0;
}

/** The machine-wide catalogue: one person's projects, none of them committed. */
function finishMachineInit(files: CatalogFiles, out: ConsoleOutput): number {
  out.line();
  out.line("Next:");
  out.line(`  1. Put LLM_API_KEY in ${files.configHome}/.env`);
  out.line(`  2. Edit ${files.promptPath} to change what the reviewer looks for.`);
  out.line("  3. cd <a checkout> && reviewer add <name>    # define a project");
  out.line("  4. reviewer projects                          # check what is defined");
  return 0;
}

/** A project to define: a name, a checkout, and where its skills are read from. */
export interface NewProject {
  readonly name: string;
  /** The checkout to review. */
  readonly localPath: string;
  /**
   * Where this project's skills come from: a path inside the reviewed
   * repository (relative, which is what CI wants), or `null` to use the
   * catalogue's shared per-project directory on this machine.
   */
  readonly skillsPath: string | null;
}

/**
 * Define a project in the catalogue.
 *
 * Refusing an existing name rather than merging: a project entry holds rules
 * someone wrote, and no scaffold is worth the chance of rewriting them. The
 * skills directory is created only for a machine-local project, because a
 * relative `skills.path` names a directory inside the reviewed repository,
 * which is that repository's to create and commit.
 */
export function addProject(
  catalog: Catalog | null,
  files: CatalogFiles,
  out: ConsoleOutput,
  project: NewProject,
): number {
  if (catalog === null) {
    out.line(`No catalogue at ${files.path}.`);
    out.line("Run 'reviewer init' first, then add the project.");
    return 1;
  }
  if (catalog.projects.has(project.name)) {
    out.line(`${files.path} already defines a project named '${project.name}'.`);
    out.line("Edit it there, or choose another name.");
    return 1;
  }

  // Bound once so the two homes below are distinguished by a narrowed value
  // rather than by a flag the type system cannot follow.
  const inRepo = project.skillsPath;
  files.addProject(project.name, {
    "local-path": project.localPath,
    ...(inRepo !== null && { skills: { path: inRepo, mappings: {} } }),
  });
  out.line(`Added project '${project.name}' to ${files.path}`);
  out.line(`  reviews: ${project.localPath}`);

  const skills =
    inRepo === null ? machineSkills(files, project.name, out) : repoSkills(inRepo, out);

  out.line();
  out.line("Next:");
  out.line(`  1. Put this project's review skills (*.md with a 'name:' frontmatter) in ${skills}`);
  out.line(
    `  2. Map them to paths: projects.${project.name}.skills.mappings in ${files.path} -- a skill mapped nowhere never applies.`,
  );
  out.line(`  3. reviewer --project ${project.name} --preview --base main   # free, no model call`);
  out.line(`  4. reviewer --project ${project.name} --base main`);
  return 0;
}

/**
 * The project's skills inside the reviewed repository: versioned with the
 * code, and the only home a CI runner can read.
 */
function repoSkills(path: string, out: ConsoleOutput): string {
  out.line(`  skills : ${path} (inside the reviewed repository, versioned with its code)`);
  return path;
}

/** The project's skills on this machine, for rules not committed anywhere. */
function machineSkills(files: CatalogFiles, project: string, out: ConsoleOutput): string {
  const directory = files.skillsDirectory(project);
  const wasCreated = files.createSkillsDirectory(project);
  out.line(`  skills : ${directory}${wasCreated ? " (created)" : ""}`);
  out.line("           note: on this machine only -- a CI runner cannot read it.");
  return directory;
}

/** Print the defined projects, so a name never has to be guessed. */
export function listProjects(
  catalog: Catalog | null,
  expectedPath: string,
  out: ConsoleOutput,
): number {
  if (catalog === null) {
    out.line(`No catalogue at ${expectedPath}.`);
    out.line("Run 'reviewer init' to create one.");
    return 1;
  }
  out.line(catalog.source);
  if (catalog.projects.size === 0) {
    out.line("  (no projects defined)");
    return 1;
  }
  const names = sortedByCodePoint(catalog.projects.keys());
  const width = Math.max(...names.map((name) => countCodePoints(name)));
  for (const name of names) {
    const project = catalog.projects.get(name);
    if (project === undefined) continue;
    // What a project *is* now: a checkout to read. An unset `local-path` is
    // not a fault -- the run reads the current directory -- so it is spelled
    // out rather than reported as missing.
    const path = catalog.settingsFor(project)["local-path"];
    const where = typeof path === "string" && path !== "" ? path : "(current directory)";
    out.line(`  ${name.padEnd(width)}  ${where}`);
  }
  return 0;
}
