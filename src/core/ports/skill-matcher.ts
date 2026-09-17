/**
 * What the per-file review step needs from a set of skills: which ones apply
 * to a path, and how they read once rendered into a prompt block.
 *
 * The registry is the production implementation; a test hands in a stub.
 */

import { type Skill } from "../domain/skill";

export interface SkillMatcher {
  /** All skills whose globs match `path`, in a stable order. */
  skillsFor(path: string): Skill[];
  /** Matching skills rendered into a prompt block within the char budget. */
  renderFor(path: string, maxSkillChars: number, maxTotalChars: number): string;
}
