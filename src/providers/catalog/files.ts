/**
 * The `CatalogFiles` port on disk. Adding a project edits the YAML document model so every comment survives.
 * @packageDocumentation
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { parseDocument } from "yaml";

import { type CatalogFiles, type CatalogHome } from "../../core/ports/catalog-files";
import { CatalogError, errorMessage } from "../../core/util/errors";

import { isRepoConfig } from "./paths";

/** The catalogue and its sibling files on the filesystem. */
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

  /** `skills/` for a repository's one project; `skills/<project>/` in the machine's catalogue. */
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

  /**
   * Adds a project through the YAML document model.
   *
   * @throws {@link CatalogError} when the file cannot be read or is not valid YAML.
   */
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
    if (!document_.has("projects")) document_.set("projects", {});
    document_.setIn(["projects", name], entry);
    writeFileSync(this.path, document_.toString(), "utf8");
  }
}

function writeCreatingParents(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, "utf8");
}
