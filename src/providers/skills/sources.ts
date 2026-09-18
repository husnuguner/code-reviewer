/**
 * Where skills come from: a directory on this machine, or the checkout under
 * review.
 *
 * The project's `skills.path` decides. An absolute (or `~`) path is a
 * directory on the reviewer's machine -- typically `~/.config/reviewer/skills`.
 * A relative path is inside the reviewed repository, read from the working
 * tree, so a branch that revises a convention is reviewed under the revised
 * rule. Both hand back the same `Skill` objects, so nothing downstream knows
 * which one ran.
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

/**
 * Shared by both readers deliberately: they read the same repository's own
 * skills and only the transport differs, so the registry's override policy
 * must treat them as one source rather than ranking one above the other.
 */
export const REPO_SOURCE_NAME = "repo";

/** A skill document: where it came from (for logs) and its text. */
export type SkillDocument = readonly [label: string, text: string];

export interface SkillSourceOptions {
  readonly parser?: SkillParser;
  readonly logger?: Logger;
}

/**
 * The shape every reader of the repository's skills shares: a normalised
 * repo-relative path, a parser strategy, and one `load` that reads documents
 * and parses them, skipping what is not a skill. Subclasses answer one
 * question -- where do the Markdown documents come from.
 */
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

/**
 * Skills read from a directory on this machine. `directory` is absolute; the
 * caller has already decided the path is local (`isLocalSkillsPath`) and
 * expanded `~`.
 */
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

/** Skills read from a local checkout at a repo-relative path, for branch review. */
export class WorktreeSkillSource extends DirectorySkillSource {
  constructor(root: string, path: string, options: SkillSourceOptions = {}) {
    const relative = trimSlashes(path.trim());
    super(relative === "" ? "" : join(root, relative), options);
  }
}

/**
 * Whether a `skills.path` names a directory on this machine rather than one
 * inside the reviewed repository: absolute, or under the home directory.
 */
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

/** Every `*.md` under `directory`, recursively, in a stable (sorted) order. */
async function markdownFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => join(entry.parentPath, entry.name))
    .toSorted(compareCodePoints);
}
