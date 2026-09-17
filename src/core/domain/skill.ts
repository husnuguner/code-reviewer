/**
 * A Skill: one file of review guidelines scoped to a set of path globs.
 *
 * A skill applies to a changed file when one of its globs matches that file's
 * path; matching skills are injected into that file's review in addition to
 * the standing lenses. Skills belong to the repository whose code they govern,
 * not to the reviewer.
 */

import { isGlobMatch } from "../skills/glob";

export interface Skill {
  /** The unique id; a repeated name is one skill declared twice. */
  readonly name: string;
  /**
   * Path globs the skill reviews: `**` across directories, `*` within a
   * segment. Set by the project's `skills.mappings` and by nothing else -- a
   * document leaves the parser with none, so an unmapped skill never matches.
   */
  readonly globs: readonly string[];
  /** The guidance text injected into the review prompt. */
  readonly body: string;
  /** Which source produced it (`"repo"` for the reviewed repository). */
  readonly source: string;
  readonly description: string;
}

/** True if any of the skill's globs match the given repository path. */
export function isSkillMatch(skill: Skill, path: string): boolean {
  return skill.globs.some((glob) => isGlobMatch(path, glob));
}
