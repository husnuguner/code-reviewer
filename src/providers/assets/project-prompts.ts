/**
 * The project's own standing instructions, read from the directory beside
 * the catalogue.
 *
 * A repository may have things the reviewer should know on every file, not
 * just the ones a skill's globs match. They go in Markdown files under
 * `prompts/` next to `config.yaml` -- `.review/prompts/` in a repository,
 * `~/.config/reviewer/prompts/` for the machine-wide catalogue -- and every
 * `*.md` under it, at any depth, is read in path order. Nothing names them:
 * the catalogue used to list the same files the convention already fixed,
 * which was one place too many for the same fact to be wrong.
 *
 * Each file keeps its own label (`prompts/security.md`), so the model is
 * told which instruction came from where rather than one anonymous wall of
 * text, and so is the log.
 *
 * A file that cannot be read is logged and skipped, not fatal: losing one
 * set of standing instructions degrades a review, and losing the whole
 * review because one file was unreadable is worse.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, relative, sep } from "node:path";

import { type Logger, NULL_LOGGER } from "../../core/ports/logger";
import { type StandingInstruction } from "../../core/review/prompts";
import { errorMessage } from "../../core/util/errors";
import { compareCodePoints, show } from "../../core/util/text";

/** The directory, beside the catalogue, a project's standing instructions live in. */
export const PROMPTS_DIR_NAME = "prompts";

/**
 * Where this run's standing instructions are: `prompts/` beside the
 * catalogue, whether that catalogue exists yet or not. Derived from the
 * catalogue's path rather than configured, so the answer to "where do I put
 * this?" is the same in every repository.
 */
export function promptsDirectory(catalogPath: string): string {
  return join(dirname(catalogPath), PROMPTS_DIR_NAME);
}

/**
 * Every standing instruction in `directory`, deepest paths included, in path
 * order.
 *
 * Empty when the directory is absent or holds nothing but empty files, which
 * is the ordinary case: the reviewer's policy then stands alone, exactly as
 * it did before a repository had anything to add.
 */
export function readProjectPrompts(
  directory: string,
  logger: Logger = NULL_LOGGER,
): StandingInstruction[] {
  if (directory.trim() === "") return [];
  const log = logger.child("prompts");
  const files = markdownFiles(directory);
  if (files === null) {
    log.info(`No prompts directory at ${directory}; the policy stands alone.`);
    return [];
  }
  const instructions: StandingInstruction[] = [];
  for (const file of files) {
    const label = labelOf(directory, file);
    try {
      const text = readFileSync(file, "utf8").trim();
      if (text === "") {
        log.info(`Prompt file ${show(label)} is empty; nothing added.`);
        continue;
      }
      instructions.push({ label, text });
      log.info(`Prompt file ${show(label)}: ${text.length} character(s) added to the policy.`);
    } catch (error) {
      log.warn(`Prompt file ${show(label)} could not be read: ${errorMessage(error)}`);
    }
  }
  return instructions;
}

/**
 * How a file is announced to the model and in the log: the directory's own
 * name and the path below it (`prompts/api/errors.md`), always with forward
 * slashes, so the label is the same thing an operator would type.
 */
function labelOf(directory: string, file: string): string {
  return [basename(directory), ...relative(directory, file).split(sep)].join("/");
}

/**
 * Every `*.md` under `directory`, recursively, sorted; `null` when there is
 * no such directory -- which is not an error, only a project with nothing to
 * add.
 */
function markdownFiles(directory: string): string[] | null {
  try {
    return statSync(directory).isDirectory()
      ? readdirSync(directory, { withFileTypes: true, recursive: true })
          .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
          .map((entry) => join(entry.parentPath, entry.name))
          .toSorted(compareCodePoints)
      : null;
  } catch {
    return null;
  }
}
