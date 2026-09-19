/**
 * What the per-file step needs from a set of skills.
 * @packageDocumentation
 */

import { type Skill } from "../domain/skill";

/** Matches skills to paths and renders them into a prompt block. */
export interface SkillMatcher {
  /** Every skill whose globs match `path`, in a stable order. */
  skillsFor(path: string): Skill[];
  /**
   * The matching skills as a prompt block.
   *
   * @param maxSkillChars - Cap on one skill's body.
   * @param maxTotalChars - Cap on the whole block.
   */
  renderFor(path: string, maxSkillChars: number, maxTotalChars: number): string;
}
