/**
 * What the per-file step needs from a set of skills.
 * @packageDocumentation
 */

/**
 * What one file's skills block came to.
 *
 * @remarks The names are what the block carries, not what matched: a skill the block's ceiling left out is
 * in neither, so nothing downstream can report a skill the model never saw.
 */
export interface RenderedSkills {
  /** The block, or `""` when nothing matched. */
  readonly text: string;
  /** The skills the block carries, in the order they appear in it. */
  readonly applied: readonly string[];
}

/** Matches skills to paths and renders them into a prompt block. */
export interface SkillMatcher {
  /**
   * The matching skills as a prompt block.
   *
   * @param maxSkillChars - Cap on one skill's body; the whole block has a fixed ceiling, not a setting.
   */
  renderFor(path: string, maxSkillChars: number): RenderedSkills;
}
