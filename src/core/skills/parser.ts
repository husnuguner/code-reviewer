/**
 * Skill document parsing. The default reads Markdown with a YAML frontmatter block.
 * @packageDocumentation
 */

import { parse as parseYaml } from "yaml";

import { type Skill } from "../domain/skill";
import { type Logger, NULL_LOGGER } from "../ports/logger";
import { errorMessage } from "../util/errors";
import { isPlainObject } from "../util/json";
import { asText } from "../util/text";

/** Turns one raw document into a skill. */
export interface SkillParser {
  /** A skill, or `null` when `text` is not a valid skill document. */
  parse(text: string, source: string): Skill | null;
}

/** A leading `---\n…\n---\n` block. */
const FRONTMATTER = /^---\s*\n([^]*?)\n---\s*\n?([^]*)$/u;

/**
 * Parses Markdown with a leading YAML frontmatter block.
 *
 * @remarks Frontmatter must declare `name`; `description` is optional; other keys are ignored. The
 * document never sets its own globs. YAML is read with 1.1 semantics.
 */
export class FrontmatterSkillParser implements SkillParser {
  private readonly log: Logger;

  constructor(logger: Logger = NULL_LOGGER) {
    this.log = logger.child("skills.parser");
  }

  /**
   * Parses one document.
   *
   * @param text - The document.
   * @param source - The source name recorded on the skill.
   * @returns The skill, or `null` (with a warning) when frontmatter is missing, invalid, or has no `name`.
   */
  parse(text: string, source: string): Skill | null {
    const split = this.split(text, source);
    if (split === null) return null;
    const [meta, body] = split;

    const rawName = meta["name"];
    const name = typeof rawName === "string" ? rawName.trim() : "";
    if (name === "") {
      this.log.warn(`Skipping skill (${source}): missing 'name'.`);
      return null;
    }

    return {
      name,
      globs: [],
      body: body.trim(),
      source,
      description: asText(meta["description"] ?? "").trim(),
    };
  }

  /** Frontmatter → `[metadata, body]`, or `null` if absent, invalid, or not a mapping. */
  private split(text: string, source: string): [Record<string, unknown>, string] | null {
    const match = FRONTMATTER.exec(text);
    if (match?.[1] === undefined || match[2] === undefined) return null;
    // YAML reads a bare `\r` as a line break; normalise CRLF first.
    const yamlText = match[1].replaceAll(/\r\n?/gu, "\n");
    let meta: unknown;
    try {
      meta = parseYaml(yamlText, { version: "1.1", uniqueKeys: false }) ?? {};
    } catch (error) {
      const detail = errorMessage(error);
      this.log.warn(`Skipping skill (${source}): invalid frontmatter: ${detail}`);
      return null;
    }
    return isPlainObject(meta) ? [meta, match[2]] : null;
  }
}

/**
 * Parses `[label, text]` documents, skipping those that do not parse.
 *
 * @param parser - The strategy.
 * @param documents - Each document with a label for the log.
 * @param sourceName - Recorded on every skill.
 * @returns The skills that parsed. A non-skill file (a README) is skipped at DEBUG.
 */
export function parseSkillDocuments(
  parser: SkillParser,
  documents: readonly (readonly [label: string, text: string])[],
  sourceName: string,
  logger: Logger = NULL_LOGGER,
): Skill[] {
  const log = logger.child("skills.source");
  const skills: Skill[] = [];
  for (const [label, text] of documents) {
    const skill = parser.parse(text, sourceName);
    if (skill === null) {
      log.debug(`${label} is not a skill document; skipping.`);
    } else {
      skills.push(skill);
    }
  }
  return skills;
}
