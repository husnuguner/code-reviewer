/**
 * Standing instructions: every `*.md` under `prompts/` beside a config file, read in path order, each labelled
 * with its file. The repository's directory is read when it says anything; otherwise the machine's.
 * @packageDocumentation
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, relative, sep } from "node:path";

import { type Logger, NULL_LOGGER } from "../../core/ports/logger";
import { type StandingInstruction } from "../../core/review/prompts";
import { errorMessage } from "../../core/util/errors";
import { compareCodePoints, show } from "../../core/util/text";

/** The directory beside a config file that holds standing instructions. */
export const PROMPTS_DIR_NAME = "prompts";

/** `prompts/` beside a config file, whether or not the file exists yet. */
export function promptsDirectory(configPath: string): string {
  return join(dirname(configPath), PROMPTS_DIR_NAME);
}

/**
 * The standing instructions in force: the repository's when its `prompts/` holds at least one non-empty file,
 * else the machine's. The two are never combined.
 *
 * @param repoDirectory - The repository's `prompts/`, or `null` outside a checkout that carries `.review/`.
 * @param machineDirectory - The machine's `prompts/`.
 */
export function readStandingInstructions(
  repoDirectory: string | null,
  machineDirectory: string,
  logger: Logger = NULL_LOGGER,
): StandingInstruction[] {
  const log = logger.child("prompts");
  if (repoDirectory !== null) {
    const own = readProjectPrompts(repoDirectory, logger);
    if (own.length > 0) {
      log.info(`Standing instructions: ${repoDirectory} (${own.length} file(s)).`);
      return own;
    }
    log.debug(`The repository's ${repoDirectory} says nothing; reading the machine's prompts.`);
  }
  const shared = readProjectPrompts(machineDirectory, logger);
  if (shared.length > 0) {
    log.info(`Standing instructions: ${machineDirectory} (${shared.length} file(s)).`);
  }
  return shared;
}

/**
 * Reads every standing instruction in `directory`, recursively, in path order.
 *
 * @returns The instructions; `[]` when the directory is absent or holds only empty files. A file that
 * cannot be read is warned about and skipped.
 */
export function readProjectPrompts(
  directory: string,
  logger: Logger = NULL_LOGGER,
): StandingInstruction[] {
  if (directory.trim() === "") return [];
  const log = logger.child("prompts");
  const files = markdownFiles(directory);
  if (files === null) {
    log.debug(`No prompts directory at ${directory}; the policy stands alone.`);
    return [];
  }
  const instructions: StandingInstruction[] = [];
  for (const file of files) {
    const label = labelOf(directory, file);
    try {
      const text = readFileSync(file, "utf8").trim();
      if (text === "") {
        log.debug(`Prompt file ${show(label)} is empty; nothing added.`);
        continue;
      }
      instructions.push({ label, text });
      log.debug(`Prompt file ${show(label)}: ${text.length} character(s) added to the policy.`);
    } catch (error) {
      log.warn(`Prompt file ${show(label)} could not be read: ${errorMessage(error)}`);
    }
  }
  return instructions;
}

/** The file's label: the directory's name plus the path below it, forward slashes (`prompts/api/errors.md`). */
function labelOf(directory: string, file: string): string {
  return [basename(directory), ...relative(directory, file).split(sep)].join("/");
}

/** Every `*.md` under `directory`, recursively, sorted; `null` when there is no such directory. */
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
