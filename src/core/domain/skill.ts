/**
 * A skill: one file of review guidelines scoped to path globs.
 * @packageDocumentation
 */

import { isGlobMatch } from "../skills/glob";

/** Review guidelines that apply to the paths their globs match. */
export interface Skill {
  /** The unique id. */
  readonly name: string;
  /** Path globs the skill reviews; set only by the project's `skills.mappings`. */
  readonly globs: readonly string[];
  /** The guidance text injected into the prompt. */
  readonly body: string;
  /** Which source produced it (`"repo"` for the reviewed repository). */
  readonly source: string;
  /** The frontmatter description, or `""`. */
  readonly description: string;
}

/**
 * Whether any of the skill's globs match a path.
 *
 * @param skill - The skill.
 * @param path - A repository-relative path.
 */
export function isSkillMatch(skill: Skill, path: string): boolean {
  return skill.globs.some((glob) => isGlobMatch(path, glob));
}
