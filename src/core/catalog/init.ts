/**
 * `reviewer init`: writes a starter catalogue and the files beside it. Never overwrites.
 * @packageDocumentation
 */

import { type CatalogFiles } from "../ports/catalog-files";
import { type ConsoleOutput } from "../ports/console";

/** What `init` installs. */
export interface StarterFiles {
  /** The starter `config.yaml`. */
  readonly catalog: string;
  /** The README written into the skills folder. */
  readonly skillsReadme: string;
}

/**
 * Writes the starter catalogue and, in a repository, `prompts/prompts.md`, `skills/README.md` and `.gitignore`.
 *
 * @returns `0` on success; `1` when the catalogue already exists.
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
  return files.home === "repo"
    ? finishRepoInit(files, out, starter)
    : finishMachineInit(files, out);
}

/** Writes the sidecar files of a repository's `.review/` and prints the next steps. */
function finishRepoInit(files: CatalogFiles, out: ConsoleOutput, starter: StarterFiles): number {
  if (!files.sidecarExists("prompts/prompts.md")) {
    files.writeSidecar("prompts/prompts.md", "");
    out.line(`Wrote ${files.directory}/prompts/prompts.md`);
  }
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
    `  2. Say what holds for every file of this repository: ${files.directory}/prompts/prompts.md (every *.md in that folder is read).`,
  );
  out.line(
    `  3. Add this project's review skills to ${files.directory}/skills/ -- see the README there.`,
  );
  out.line(`  4. Map each skill to the paths it reviews: skills.mappings in ${files.path}.`);
  out.line("  5. reviewer --preview --base main    # what would be reviewed; no model call");
  out.line("  6. reviewer --base main");
  return 0;
}

/** Prints the next steps for a machine-wide catalogue. */
function finishMachineInit(files: CatalogFiles, out: ConsoleOutput): number {
  out.line();
  out.line("Next:");
  out.line(`  1. Put LLM_API_KEY in ${files.configHome}/.env`);
  out.line("  2. cd <a checkout> && reviewer add <name>    # define a project");
  out.line("  3. reviewer projects                          # check what is defined");
  return 0;
}
