/**
 * Settings that are each legal and together contradict. The schema validates one setting at a time; this
 * reads the resolved configuration as a whole and says where it disagrees with itself.
 * @packageDocumentation
 */

import { type Config } from "./config";
import { FIELD_PATHS } from "./schema";

/**
 * Every way a configuration disagrees with itself.
 *
 * @param config - The resolved configuration, files and environment already merged.
 * @returns One line per contradiction, in a fixed order, ready to log; `[]` when the settings agree.
 * @remarks Warnings, not errors: each setting is legal on its own and a project may mean the combination.
 * What it must not be is silent -- every line here names a rule the review would quietly not apply.
 */
export function configIncoherences(config: Config): string[] {
  const lines: string[] = [];
  const hasSkills = config.skillsPath.trim() !== "";
  const scoped = Object.keys(config.skillMappings).length + config.skillDefaults.length;

  if (!hasSkills && scoped > 0) {
    lines.push(
      `${FIELD_PATHS.skillsPath} is empty, so no skill is loaded, but ${FIELD_PATHS.skillDefaults} and ${FIELD_PATHS.skillMappings} scope ${scoped} entr${scoped === 1 ? "y" : "ies"}: they hold nothing to a rule. Name the skills directory, or drop the tables.`,
    );
  }
  if (!hasSkills) return lines;

  if (config.maxSkillChars <= 0) {
    lines.push(
      `${FIELD_PATHS.maxSkillChars} is ${config.maxSkillChars}, which cuts every skill's body to nothing: a file's prompt would carry the skills' names and none of their rules.`,
    );
  }
  return lines;
}
