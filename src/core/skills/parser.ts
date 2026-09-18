/**
 * Skill parsing strategies.
 *
 * A `SkillParser` turns one raw skill document into a `Skill` (or `null` when
 * invalid). Sources hold a parser instance, so a different document format can
 * be plugged in without touching the sources. The default reads Markdown with
 * a leading YAML frontmatter block.
 */

import { parse as parseYaml } from "yaml";

import { type Skill } from "../domain/skill";
import { type Logger, NULL_LOGGER } from "../ports/logger";
import { errorMessage } from "../util/errors";
import { isPlainObject } from "../util/json";
import { asText } from "../util/text";

export interface SkillParser {
  /** A skill, or `null` when `text` is not a valid skill document. */
  parse(text: string, source: string): Skill | null;
}

// Leading YAML frontmatter block: ---\n ... \n---\n
const FRONTMATTER = /^---\s*\n([^]*?)\n---\s*\n?([^]*)$/u;

/**
 * Parse Markdown with a leading YAML frontmatter block (the default strategy).
 *
 * Frontmatter must declare `name`; `description` is optional. Which files a
 * skill reviews is *not* the document's to say: that is the project's
 * `skills.mappings` in the catalogue, so a skill leaves the parser
 * with no globs of its own and any other frontmatter key is ignored. Returns
 * `null` (logging a warning) when frontmatter is missing, the YAML is invalid,
 * or `name` is absent. YAML is read with 1.1 semantics (`yes` is a boolean,
 * `1_000` a number), the dialect skill authors have been writing against.
 */
export class FrontmatterSkillParser implements SkillParser {
  private readonly log: Logger;

  constructor(logger: Logger = NULL_LOGGER) {
    this.log = logger.child("skills.parser");
  }

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
      // The document has no say over its own scope; the catalogue's mapping
      // fills this in, and an unmapped skill never matches.
      globs: [],
      body: body.trim(),
      source,
      description: asText(meta["description"] ?? "").trim(),
    };
  }

  /** Frontmatter -> `[metadata, body]`; `null` if absent, invalid, or not a mapping. */
  private split(text: string, source: string): [Record<string, unknown>, string] | null {
    const match = FRONTMATTER.exec(text);
    if (match?.[1] === undefined || match[2] === undefined) return null;
    // YAML treats a bare `\r` as a line break; a CRLF document leaves one on
    // the last frontmatter line, so line endings are normalised first.
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
 * Parse `[label, text]` documents, skipping what does not parse.
 *
 * A file without valid frontmatter is not an error -- a README sitting in a
 * skills directory is the ordinary case -- so it is skipped quietly.
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
