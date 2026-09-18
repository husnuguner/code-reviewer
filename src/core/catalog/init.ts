/**
 * `init`: write a starter catalogue where it belongs, and the files beside it.
 *
 * Exists so the first run is "run it, then edit it" rather than "copy YAML
 * out of a README". Refuses to overwrite: this file holds the operator's own
 * project definitions, and no scaffold is worth the chance of rewriting them.
 */

import { type CatalogFiles } from "../ports/catalog-files";
import { type ConsoleOutput } from "../ports/console";

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
