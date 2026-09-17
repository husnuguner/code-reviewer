/**
 * The skill registry: load sources, apply the project's skill mappings, match
 * + render.
 */

import { type SkillMappings } from "../config/settings";
import { type Skill, isSkillMatch } from "../domain/skill";
import { type Logger, NULL_LOGGER } from "../ports/logger";
import { type SkillMatcher } from "../ports/skill-matcher";
import { type SkillSource } from "../ports/skill-source";
import { errorMessage } from "../util/errors";
import { compareCodePoints, pyLength, pyRepr, pySlice, pySorted } from "../util/py";

/** Holds the merged set of skills and selects/renders them per file. */
export class SkillRegistry implements SkillMatcher {
  private readonly skills: readonly Skill[];
  private readonly log: Logger;

  /**
   * A name identifies a skill, so a repeated name is one skill declared twice
   * and the later declaration wins (keeping the first one's position). With a
   * single source this is only reachable within one directory, where it means
   * two files claim the same name -- worth being deterministic about, not
   * worth ranking.
   */
  constructor(skills: readonly Skill[], logger: Logger = NULL_LOGGER) {
    this.log = logger.child("skills.registry");
    const best = new Map<string, Skill>();
    for (const skill of skills) {
      if (best.has(skill.name)) {
        this.log.info(`Skill ${pyRepr(skill.name)} declared more than once; using the last.`);
      }
      best.set(skill.name, skill);
    }
    this.skills = best.values().toArray();
  }

  /**
   * Load the given sources into one registry and apply the project's `mappings`.
   *
   * Callers choose the source, because only they know which repository is
   * reachable how. Passing no source is valid and yields an empty registry --
   * a project that names no skills path is reviewed by the lenses alone.
   *
   * A source that fails is logged and skipped rather than fatal: losing
   * project conventions degrades a review, but losing the whole review because
   * a directory could not be listed is worse.
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
    const names = pySorted(registry.skills.map((s) => s.name)).join(", ");
    log.info(`Loaded ${registry.skills.length} skill(s): ${names || "(none)"}`);
    return registry;
  }

  /** All skills whose globs match `path`, in a stable order. */
  skillsFor(path: string): Skill[] {
    return this.skills
      .filter((skill) => isSkillMatch(skill, path))
      .toSorted((a, b) => compareCodePoints(a.name, b.name));
  }

  /**
   * Render matching skills into a prompt block within the char budget.
   *
   * `maxSkillChars` truncates one skill's body; `maxTotalChars` caps the whole
   * block, and a skill that would overflow it is skipped (and named in an INFO
   * log). The first matching skill is always included, so a single oversized
   * skill still reaches the prompt rather than silencing every rule.
   */
  renderFor(path: string, maxSkillChars: number, maxTotalChars: number): string {
    const matched = this.skillsFor(path);
    if (matched.length === 0) return "";
    const blocks: string[] = [];
    const skipped: string[] = [];
    let used = 0;
    for (const skill of matched) {
      const block = `## ${skill.name}\n${pySlice(skill.body, 0, maxSkillChars)}`;
      const size = pyLength(block);
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
 * The project's say over which files each skill reviews -- the only say.
 *
 * A skill document carries no scope of its own: the catalogue's
 * `skills.mappings` is where a project states which files a skill reviews,
 * and a mapping of `[]` switches a skill off without touching the file. So a
 * loaded skill that no mapping names can never match, and that is almost
 * always a forgotten line rather than a decision -- it is reported as a
 * warning, once. A mapping for a skill that was not loaded is almost always
 * a typo, and says so too.
 */
export function applyMappings(
  skills: readonly Skill[],
  mappings: SkillMappings,
  log: Logger = NULL_LOGGER,
): Skill[] {
  const loaded = new Set(skills.map((skill) => skill.name));
  for (const name of Object.keys(mappings)) {
    if (!loaded.has(name)) {
      log.warn(`Skill mapping for ${pyRepr(name)} matches no loaded skill; check the name.`);
    }
  }
  return skills.map((skill) => {
    const mapped = Object.hasOwn(mappings, skill.name) ? mappings[skill.name] : undefined;
    if (mapped === undefined) {
      // Loaded, unreachable, and nobody said so on purpose.
      log.warn(
        `Skill ${pyRepr(skill.name)} has no entry in the project's skills.mappings and will not be applied to any file. Map it (skills.mappings.${skill.name}: ["<glob>"]) or switch it off explicitly with [].`,
      );
      return skill;
    }
    if (mapped.length === 0) {
      log.info(`Skill ${pyRepr(skill.name)} is switched off by the project's skills.mappings.`);
    }
    return { ...skill, globs: mapped };
  });
}
