/**
 * The skill registry: loads sources, applies the project's mappings, matches and renders per file.
 * @packageDocumentation
 */

import { type SkillDefaults, type SkillMappings } from "../config/settings";
import { type Skill, isSkillMatch } from "../domain/skill";
import { type Logger, NULL_LOGGER } from "../ports/logger";
import { type RenderedSkills, type SkillMatcher } from "../ports/skill-matcher";
import { type SkillSource } from "../ports/skill-source";
import { errorMessage } from "../util/errors";
import {
  compareCodePoints,
  countCodePoints,
  cutToLength,
  sortedByCodePoint,
  show,
} from "../util/text";

/**
 * A safety ceiling on one file's skills block, in code points. A constant, not a setting: a block this
 * long is a mapping mistake -- every skill pointed at one glob -- and not a budget somebody chose. What
 * a project tunes is `skills.max-chars`, which bounds each skill's own body.
 */
export const MAX_SKILLS_BLOCK_CHARS = 200_000;

/** The merged set of skills, selected and rendered per file. */
export class SkillRegistry implements SkillMatcher {
  private readonly skills: readonly Skill[];
  private readonly log: Logger;
  /** Skills already reported as left out by the budget; a run says each once, not once per file. */
  private readonly reportedOverflow = new Set<string>();

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
   * Loads the sources into one registry and scopes every skill by the project's baseline and mappings.
   *
   * @param sources - Where skills come from; none yields an empty registry.
   * @param mappings - Skill name → globs.
   * @param defaults - Glob → the skills every file it matches is held to.
   * @returns The registry. A source that fails is logged and skipped.
   */
  static async build(
    sources: readonly SkillSource[],
    logger: Logger = NULL_LOGGER,
    mappings: SkillMappings = {},
    defaults: SkillDefaults = [],
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
    const registry = new SkillRegistry(applyMappings(skills, mappings, defaults, log), logger);
    const names = sortedByCodePoint(registry.skills.map((s) => s.name)).join(", ");
    // Said at INFO when there is something to say; a repository without skills hears it with -v.
    if (registry.skills.length === 0) log.debug("Loaded 0 skill(s).");
    else log.info(`Loaded ${registry.skills.length} skill(s): ${names}`);
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
   * @returns The block and the skills it carries; `""` and `[]` when nothing matches. Every matching skill
   * is carried unless the block would pass {@link MAX_SKILLS_BLOCK_CHARS}; the first is always included.
   * @remarks A skill the ceiling leaves out is a rule the review silently would not have applied, so it is
   * a warning and not a note, and it is absent from `applied` rather than reported as if the model saw it.
   * The warning names each skill once per run: the same ceiling over a thousand files is one fact, not a
   * thousand, and a flooded log is one nobody reads.
   */
  renderFor(path: string, maxSkillChars: number): RenderedSkills {
    const matched = this.skillsFor(path);
    if (matched.length === 0) return { text: "", applied: [] };
    const blocks: string[] = [];
    const applied: string[] = [];
    const skipped: string[] = [];
    let used = 0;
    for (const skill of matched) {
      const block = `## ${skill.name}\n${cutToLength(skill.body, maxSkillChars)}`;
      const size = countCodePoints(block);
      if (used + size > MAX_SKILLS_BLOCK_CHARS && blocks.length > 0) {
        skipped.push(skill.name);
        continue;
      }
      blocks.push(block);
      applied.push(skill.name);
      used += size;
    }
    const unreported = skipped.filter((name) => !this.reportedOverflow.has(name));
    if (unreported.length > 0) {
      for (const name of unreported) this.reportedOverflow.add(name);
      this.log.warn(
        `Skill budget reached for ${path}: the ${MAX_SKILLS_BLOCK_CHARS}-character ceiling on a file's skills block left ${show(unreported)} out of the prompt, so that file was not reviewed against them. Shorten those skills, lower skills.max-chars, or narrow their globs. Each skill is said once; later files are not repeated.`,
      );
    }
    const header =
      "Project/framework standards for this file (apply IN ADDITION to the four lenses):";
    return { text: `${header}\n\n${blocks.join("\n\n")}`, applied };
  }
}

/**
 * Sets each skill's globs from the project's baseline and mappings: a skill named by `skills.defaults`
 * reviews that glob, and a `skills.mappings` entry adds the paths only that skill reviews.
 *
 * @param defaults - The baseline a whole language or area shares: globs, then the skills they are held to.
 * @returns The skills with globs applied. A skill neither defaulted nor mapped (it never matches), and a
 * name in either table that no loaded skill answers to, are each warned about; a mapping of `[]` switches a
 * skill off at INFO, baseline and all.
 */
export function applyMappings(
  skills: readonly Skill[],
  mappings: SkillMappings,
  defaults: SkillDefaults = [],
  log: Logger = NULL_LOGGER,
): Skill[] {
  const baseline = invertDefaults(defaults);
  const loaded = new Set(skills.map((skill) => skill.name));
  for (const name of Object.keys(mappings)) {
    if (!loaded.has(name)) {
      log.warn(`Skill mapping for ${show(name)} matches no loaded skill; check the name.`);
    }
  }
  for (const name of Object.keys(baseline)) {
    if (!loaded.has(name)) {
      log.warn(`Skill default for ${show(name)} matches no loaded skill; check the name.`);
    }
  }
  return skills.map((skill) => {
    const mapped = Object.hasOwn(mappings, skill.name) ? mappings[skill.name] : undefined;
    if (mapped?.length === 0) {
      log.info(`Skill ${show(skill.name)} is switched off by the project's skills.mappings.`);
      return { ...skill, globs: [] };
    }
    const globs = [...new Set([...(baseline[skill.name] ?? []), ...(mapped ?? [])])];
    if (globs.length === 0) {
      log.warn(
        `Skill ${show(skill.name)} is in neither the project's skills.defaults nor its skills.mappings and will not be applied to any file. Give it a scope (skills.mappings.${skill.name}: ["<glob>"], or name it in a skills.defaults entry) or switch it off explicitly with [].`,
      );
      return skill;
    }
    return { ...skill, globs };
  });
}

/**
 * Turns the baseline inside out: paths-then-skills as the file states it, `skill name → globs` as the
 * registry needs it.
 *
 * @remarks The file states it per group of paths because that is how a project thinks of it ("every
 * TypeScript file is held to these"); a skill still carries its own globs, so the two meet here.
 */
function invertDefaults(defaults: SkillDefaults): SkillMappings {
  const byName = new Map<string, string[]>();
  for (const entry of defaults) {
    for (const name of entry.skills) {
      const globs = byName.get(name) ?? [];
      for (const glob of entry.globs) if (!globs.includes(glob)) globs.push(glob);
      byName.set(name, globs);
    }
  }
  return Object.fromEntries(byName);
}
