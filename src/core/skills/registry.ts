/**
 * The skill registry: loads sources, applies the project's mappings, matches and renders per file.
 * @packageDocumentation
 */

import { type SkillMappings } from "../config/settings";
import { type Skill, isSkillMatch } from "../domain/skill";
import { type Logger, NULL_LOGGER } from "../ports/logger";
import { type SkillMatcher } from "../ports/skill-matcher";
import { type SkillSource } from "../ports/skill-source";
import { errorMessage } from "../util/errors";
import {
  compareCodePoints,
  countCodePoints,
  cutToLength,
  sortedByCodePoint,
  show,
} from "../util/text";

/** The merged set of skills, selected and rendered per file. */
export class SkillRegistry implements SkillMatcher {
  private readonly skills: readonly Skill[];
  private readonly log: Logger;

  /**
   * @param skills - Loaded skills; a repeated name keeps the last declaration in the first's position.
   */
  constructor(skills: readonly Skill[], logger: Logger = NULL_LOGGER) {
    this.log = logger.child("skills.registry");
    const best = new Map<string, Skill>();
    for (const skill of skills) {
      if (best.has(skill.name)) {
        this.log.info(`Skill ${show(skill.name)} declared more than once; using the last.`);
      }
      best.set(skill.name, skill);
    }
    this.skills = best.values().toArray();
  }

  /**
   * Loads the sources into one registry and applies the project's mappings.
   *
   * @param sources - Where skills come from; none yields an empty registry.
   * @param mappings - Skill name → globs.
   * @returns The registry. A source that fails is logged and skipped.
   */
  static async build(
    sources: readonly SkillSource[],
    logger: Logger = NULL_LOGGER,
    mappings: SkillMappings = {},
  ): Promise<SkillRegistry> {
    const log = logger.child("skills.registry");
    const skills: Skill[] = [];
    for (const source of sources) {
      try {
        skills.push(...(await source.load()));
      } catch (error) {
        const detail = errorMessage(error);
        log.warn(`Skill source ${source.sourceName} failed: ${detail}`);
      }
    }
    const registry = new SkillRegistry(applyMappings(skills, mappings, log), logger);
    const names = sortedByCodePoint(registry.skills.map((s) => s.name)).join(", ");
    log.info(`Loaded ${registry.skills.length} skill(s): ${names || "(none)"}`);
    return registry;
  }

  /** Every skill whose globs match `path`, sorted by name. */
  skillsFor(path: string): Skill[] {
    return this.skills
      .filter((skill) => isSkillMatch(skill, path))
      .toSorted((a, b) => compareCodePoints(a.name, b.name));
  }

  /**
   * Renders the matching skills into a prompt block.
   *
   * @param maxSkillChars - Truncates one skill's body.
   * @param maxTotalChars - Caps the whole block; a skill that would overflow is skipped and logged.
   * @returns The block, or `""` when nothing matches. The first matching skill is always included.
   */
  renderFor(path: string, maxSkillChars: number, maxTotalChars: number): string {
    const matched = this.skillsFor(path);
    if (matched.length === 0) return "";
    const blocks: string[] = [];
    const skipped: string[] = [];
    let used = 0;
    for (const skill of matched) {
      const block = `## ${skill.name}\n${cutToLength(skill.body, maxSkillChars)}`;
      const size = countCodePoints(block);
      if (used + size > maxTotalChars && blocks.length > 0) {
        skipped.push(skill.name);
        continue;
      }
      blocks.push(block);
      used += size;
    }
    if (skipped.length > 0) {
      this.log.info(`Skill budget reached for ${path}; skipped: ${skipped.join(", ")}`);
    }
    const header =
      "Project/framework standards for this file (apply IN ADDITION to the four lenses):";
    return `${header}\n\n${blocks.join("\n\n")}`;
  }
}

/**
 * Sets each skill's globs from the project's mappings.
 *
 * @returns The skills with globs applied. An unmapped skill (never matches) and a mapping naming no loaded
 * skill are each warned about; `[]` switches a skill off at INFO.
 */
export function applyMappings(
  skills: readonly Skill[],
  mappings: SkillMappings,
  log: Logger = NULL_LOGGER,
): Skill[] {
  const loaded = new Set(skills.map((skill) => skill.name));
  for (const name of Object.keys(mappings)) {
    if (!loaded.has(name)) {
      log.warn(`Skill mapping for ${show(name)} matches no loaded skill; check the name.`);
    }
  }
  return skills.map((skill) => {
    const mapped = Object.hasOwn(mappings, skill.name) ? mappings[skill.name] : undefined;
    if (mapped === undefined) {
      log.warn(
        `Skill ${show(skill.name)} has no entry in the project's skills.mappings and will not be applied to any file. Map it (skills.mappings.${skill.name}: ["<glob>"]) or switch it off explicitly with [].`,
      );
      return skill;
    }
    if (mapped.length === 0) {
      log.info(`Skill ${show(skill.name)} is switched off by the project's skills.mappings.`);
    }
    return { ...skill, globs: mapped };
  });
}
