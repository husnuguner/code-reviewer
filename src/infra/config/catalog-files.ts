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

import { type CatalogFiles } from "../../core/catalog/commands";
import { CatalogError, errorMessage } from "../../core/util/errors";

export class FsCatalogFiles implements CatalogFiles {
  readonly promptPath: string;

  constructor(
    readonly path: string,
    readonly configHome: string,
  ) {
    this.promptPath = join(dirname(path), "prompts", "system.md");
  }

  exists(): boolean {
    return existsSync(this.path);
  }

  write(text: string): void {
    writeCreatingParents(this.path, text);
  }

  promptExists(): boolean {
    return existsSync(this.promptPath);
  }

  writePrompt(text: string): void {
    writeCreatingParents(this.promptPath, text);
  }

  /** Where a project's own skills live when they are not inside its repository. */
  skillsDirectory(project: string): string {
    return join(dirname(this.path), "skills", project);
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
