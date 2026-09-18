/**
 * The catalogue file on disk, for the `init` and `add` commands.
 *
 * Adding a project edits the YAML through its document model rather than by
 * re-serialising a parsed object: the catalogue is hand-written and annotated,
 * and a command that stripped every comment the first time it ran would be a
 * command nobody runs twice.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { parseDocument } from "yaml";

import { type CatalogFiles, type CatalogHome } from "../../core/ports/catalog-files";
import { CatalogError, errorMessage } from "../../core/util/errors";

import { isRepoConfig } from "./paths";

export class FsCatalogFiles implements CatalogFiles {
  readonly directory: string;
  /** Read off the path: a catalogue under `.review/` is a repository's own. */
  readonly home: CatalogHome;

  constructor(
    readonly path: string,
    readonly configHome: string,
  ) {
    this.directory = dirname(path);
    this.home = isRepoConfig(path) ? "repo" : "machine";
  }

  exists(): boolean {
    return existsSync(this.path);
  }

  write(text: string): void {
    writeCreatingParents(this.path, text);
  }

  /**
   * Where a project's skills live beside this catalogue.
   *
   * A repository's `.review/` holds one project, so its skills sit directly
   * in `skills/`; the machine's catalogue holds many, one folder each.
   */
  skillsDirectory(project: string): string {
    return this.home === "repo"
      ? join(this.directory, "skills")
      : join(this.directory, "skills", project);
  }

  writeSidecar(relative: string, text: string): void {
    writeCreatingParents(join(this.directory, relative), text);
  }

  sidecarExists(relative: string): boolean {
    return existsSync(join(this.directory, relative));
  }

  createSkillsDirectory(project: string): boolean {
    const directory = this.skillsDirectory(project);
    if (existsSync(directory)) return false;
    mkdirSync(directory, { recursive: true });
    return true;
  }

  addProject(name: string, entry: Readonly<Record<string, unknown>>): void {
    let document_;
    try {
      document_ = parseDocument(readFileSync(this.path, "utf8"));
    } catch (error) {
      throw new CatalogError(`Could not read ${this.path}: ${errorMessage(error)}`);
    }
    const failure = document_.errors[0];
    if (failure !== undefined) {
      throw new CatalogError(`${this.path} is not valid YAML: ${failure.message}`);
    }
    // A catalogue written by `init` always has `projects`; one edited by hand
    // may not, and refusing it would be refusing a file that parses.
    if (!document_.has("projects")) document_.set("projects", {});
    document_.setIn(["projects", name], entry);
    writeFileSync(this.path, document_.toString(), "utf8");
  }
}

function writeCreatingParents(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, "utf8");
}
