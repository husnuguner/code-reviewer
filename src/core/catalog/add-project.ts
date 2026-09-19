/**
 * `reviewer add`: defines a project in the catalogue.
 * @packageDocumentation
 */

import { type CatalogFiles } from "../ports/catalog-files";
import { type ConsoleOutput } from "../ports/console";

import { type Catalog } from "./catalog";

/** A project to define. */
export interface NewProject {
  readonly name: string;
  /** The checkout to review. */
  readonly localPath: string;
  /** A skills path inside the reviewed repository, or `null` for the machine's per-project directory. */
  readonly skillsPath: string | null;
}

/**
 * Adds a project to the catalogue and prints what to do next.
 *
 * @returns `0` on success; `1` when there is no catalogue or the name is taken.
 * @remarks An existing name is refused, never merged.
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

/** Reports a skills path inside the reviewed repository. */
function repoSkills(path: string, out: ConsoleOutput): string {
  out.line(`  skills : ${path} (inside the reviewed repository, versioned with its code)`);
  return path;
}

/** Creates and reports the machine's per-project skills directory. */
function machineSkills(files: CatalogFiles, project: string, out: ConsoleOutput): string {
  const directory = files.skillsDirectory(project);
  const wasCreated = files.createSkillsDirectory(project);
  out.line(`  skills : ${directory}${wasCreated ? " (created)" : ""}`);
  out.line("           note: on this machine only -- a CI runner cannot read it.");
  return directory;
}
