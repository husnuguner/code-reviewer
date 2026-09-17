/**
 * The skill-source port: where review skills are read from.
 *
 * In pull request review the repository is remote and skills are read through
 * the repo provider at the head of the change; in branch review they come from
 * the working tree. Both hand back the same `Skill` objects, so nothing
 * downstream knows which one ran.
 */

import { type Skill } from "../domain/skill";

export interface SkillSource {
  /**
   * Which source produced the skills. The repository's own skills report
   * `"repo"` whether read remotely or locally, so the registry's override
   * policy treats them as one source.
   */
  readonly sourceName: string;
  /** Load and parse every skill this source has (best-effort). */
  load(): Promise<Skill[]>;
}
