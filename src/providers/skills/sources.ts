/**
 * Where skills come from: a directory on this machine, or the checkout under review. Both yield the
 * same `Skill` objects.
 * @packageDocumentation
 */

import { readFile, readdir, stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

import { type Skill } from "../../core/domain/skill";
import { type Logger, NULL_LOGGER } from "../../core/ports/logger";
import { type SkillSource } from "../../core/ports/skill-source";
import {
  FrontmatterSkillParser,
  type SkillParser,
  parseSkillDocuments,
} from "../../core/skills/parser";
import { errorMessage } from "../../core/util/errors";
import { compareCodePoints, trimSlashes } from "../../core/util/text";

/** Shared by both readers: same repository's skills, only the transport differs. */
export const REPO_SOURCE_NAME = "repo";

/** A skill document: a label for logs, and its text. */
export type SkillDocument = readonly [label: string, text: string];

/** Options for a skill source. */
export interface SkillSourceOptions {
  readonly parser?: SkillParser;
  readonly logger?: Logger;
}

/** The shared template: a normalised path, a parser, and one `load`. Subclasses say where documents come from. */
abstract class MarkdownSkillSource implements SkillSource {
  readonly sourceName = REPO_SOURCE_NAME;
  protected readonly path: string;
  protected readonly log: Logger;
  private readonly parser: SkillParser;

  constructor(path: string, options: SkillSourceOptions) {
    this.path = trimSlashes(path.trim());
    this.log = (options.logger ?? NULL_LOGGER).child("skills.source");
    this.parser = options.parser ?? new FrontmatterSkillParser(options.logger);
  }

  async load(): Promise<Skill[]> {
    if (this.path === "") return [];
    const documents = await this.documents();
    return parseSkillDocuments(this.parser, documents, this.sourceName, this.log);
  }

  /** Every Markdown document under the skills path, in a stable order. */
  protected abstract documents(): Promise<SkillDocument[]>;
}

/** Skills read from an absolute directory on this machine. */
export class DirectorySkillSource extends MarkdownSkillSource {
  constructor(
    private readonly directory: string,
    options: SkillSourceOptions = {},
  ) {
    super(directory === "" ? "" : ".", options);
  }

  protected async documents(): Promise<SkillDocument[]> {
    if (!(await isDirectory(this.directory))) {
      this.log.info(`No skills directory at ${this.directory}.`);
      return [];
    }
    const documents: SkillDocument[] = [];
    const files = await markdownFiles(this.directory);
    for (const file of files) {
      try {
        documents.push([file, await readFile(file, "utf8")]);
      } catch (error) {
        this.log.warn(`Could not read ${file}: ${errorMessage(error)}`);
      }
    }
    return documents;
  }
}

/** Skills read from a checkout at a repository-relative path. */
export class WorktreeSkillSource extends DirectorySkillSource {
  constructor(root: string, path: string, options: SkillSourceOptions = {}) {
    const relative = trimSlashes(path.trim());
    super(relative === "" ? "" : join(root, relative), options);
  }
}

/** Whether a `skills.path` names a directory on this machine: absolute, or under `~`. */
export function isLocalSkillsPath(path: string): boolean {
  const trimmed = path.trim();
  return isAbsolute(trimmed) || trimmed === "~" || trimmed.startsWith("~/");
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    const info = await stat(path);
    return info.isDirectory();
  } catch {
    return false;
  }
}

/** Every `*.md` under `directory`, recursively, sorted. */
async function markdownFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => join(entry.parentPath, entry.name))
    .toSorted(compareCodePoints);
}
