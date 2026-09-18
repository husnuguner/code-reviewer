/**
 * `add`: define a project in the catalogue.
 *
 * Refusing an existing name rather than merging: a project entry holds rules
 * someone wrote, and no scaffold is worth the chance of rewriting them. The
 * skills directory is created only for a machine-local project, because a
 * relative `skills.path` names a directory inside the reviewed repository,
 * which is that repository's to create and commit.
 */

import { type CatalogFiles } from "../ports/catalog-files";
import { type ConsoleOutput } from "../ports/console";

import { type Catalog } from "./catalog";

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
