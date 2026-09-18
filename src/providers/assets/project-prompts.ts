/**
 * The project's own prompt files, read from disk.
 *
 * A repository may put standing instructions -- what the reviewer should
 * know about this codebase on every file, not just the ones a skill's globs
 * match -- in files its catalogue names under `prompts`. They are read here,
 * in the order the catalogue named them, and handed to `systemPrompt`, which
 * appends them to the reviewer's own policy rather than replacing it.
 *
 * A named file that cannot be read is logged and skipped, not fatal: losing
 * a project's standing instructions degrades a review, and losing the whole
 * review because one path was mistyped is worse. The skip is a warning
 * because a mistyped path is almost always a mistake.
 */

import { readFileSync } from "node:fs";

import { type Logger, NULL_LOGGER } from "../../core/ports/logger";
import { errorMessage } from "../../core/util/errors";
import { show } from "../../core/util/text";

/**
 * The text of every prompt file that could be read, joined in order.
 *
 * Empty when the project names none, which is the ordinary case: the
 * reviewer's policy then stands alone, exactly as before the setting existed.
 */
export function readProjectPrompts(paths: readonly string[], logger: Logger = NULL_LOGGER): string {
  const log = logger.child("prompts");
  const texts: string[] = [];
  for (const path of paths) {
    try {
      const text = readFileSync(path, "utf8").trim();
      if (text === "") {
        log.info(`Prompt file ${show(path)} is empty; nothing added.`);
        continue;
      }
      texts.push(text);
      log.info(`Prompt file ${show(path)}: ${text.length} character(s) added to the policy.`);
    } catch (error) {
      log.warn(`Prompt file ${show(path)} could not be read: ${errorMessage(error)}`);
    }
  }
  return texts.join("\n\n");
}
