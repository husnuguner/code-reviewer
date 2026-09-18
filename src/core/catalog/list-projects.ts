/**
 * `projects`: print the defined projects, so a name never has to be guessed.
 */

import { type ConsoleOutput } from "../ports/console";
import { countCodePoints, sortedByCodePoint } from "../util/text";

import { type Catalog } from "./catalog";

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
