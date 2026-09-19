/**
 * The skill-source port: where review skills are read from.
 * @packageDocumentation
 */

import { type Skill } from "../domain/skill";

/** Loads skills from one place. */
export interface SkillSource {
  /** Which source produced the skills; the reviewed repository's report `"repo"`. */
  readonly sourceName: string;
  /** Loads and parses every skill this source has, best-effort. */
  load(): Promise<Skill[]>;
}
