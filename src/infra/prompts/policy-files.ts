/**
 * The operator's review policy, read from the files the catalogue names.
 *
 * `defaults.prompts` (or a project's `prompts`) lists Markdown files whose
 * text, in order, replaces the shipped policy half of the system prompt. The
 * output contract is appended by the core regardless, so a policy file can
 * say anything about *what* to review and nothing about *how to answer*.
 */

import { readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

import { ConfigError } from "../../core/config/config";
import { type PromptFiles } from "../../core/config/settings";
import { errorMessage } from "../../core/util/errors";
import { expandUser } from "../config/paths";

/**
 * The policy text the files spell, or `undefined` when there are none (the
 * shipped policy applies). A relative path is taken from `baseDirectory` --
 * the catalogue's own directory, so `prompts/system.md` sits beside
 * `config.json`. A file that is missing is an error at startup, not a silent
 * fallback: the operator said which policy to apply.
 */
export function readReviewPolicy(files: PromptFiles, baseDirectory: string): string | undefined {
  if (files.length === 0) return undefined;
  const texts = files.map((file) => {
    const path = resolvePromptPath(file, baseDirectory);
    try {
      return readFileSync(path, "utf8").trim();
    } catch (error) {
      throw new ConfigError(`prompts names ${path}, which cannot be read: ${errorMessage(error)}`);
    }
  });
  return texts.filter((text) => text !== "").join("\n\n");
}

/** `~` expanded; a relative path is beside the catalogue. */
export function resolvePromptPath(file: string, baseDirectory: string): string {
  const expanded = expandUser(file.trim());
  return isAbsolute(expanded) ? expanded : resolve(baseDirectory, expanded);
}

/** The directory the catalogue's relative paths are taken from. */
export function catalogDirectory(catalogPath: string): string {
  return dirname(catalogPath);
}
