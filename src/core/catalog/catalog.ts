/**
 * The catalogue as a value: `defaults` plus the `projects` that override them.
 * @packageDocumentation
 */

import { CatalogError } from "../util/errors";
import { isPlainObject } from "../util/json";
import { show, sortedByCodePoint } from "../util/text";

import { type ProjectSettingKey } from "./schema";

/** Setting values as written; the settings schema types them later. */
export type ProjectSettings = Readonly<Partial<Record<ProjectSettingKey, unknown>>>;

/** One reviewable target: a checkout plus the rules that apply to it. */
export interface ProjectSpec {
  readonly name: string;
  /** The project's own settings, not yet merged with `defaults`. */
  readonly settings: ProjectSettings;
}

/** The value as an object section, or `undefined`. */
function sectionOf(value: unknown): Record<string, unknown> | undefined {
  return isPlainObject(value) ? value : undefined;
}

/** A parsed catalogue. */
export class Catalog {
  constructor(
    readonly source: string,
    readonly projects: ReadonlyMap<string, ProjectSpec>,
    /** The root `defaults` section. */
    readonly defaults: ProjectSettings = {},
  ) {}

  /**
   * A project's settings with `defaults` underneath.
   *
   * @remarks `llm` merges key by key; `skills.path` may come from the defaults, `skills.mappings` never does.
   */
  settingsFor(project: ProjectSpec): ProjectSettings {
    const merged: Partial<Record<ProjectSettingKey, unknown>> = {
      ...this.defaults,
      ...project.settings,
    };
    const sharedLlm = sectionOf(this.defaults.llm);
    const ownLlm = sectionOf(project.settings.llm);
    if (sharedLlm !== undefined || ownLlm !== undefined) {
      merged.llm = { ...sharedLlm, ...ownLlm };
    }
    const sharedSkills = sectionOf(this.defaults.skills);
    const ownSkills = sectionOf(project.settings.skills) ?? {};
    if (sharedSkills !== undefined) {
      const path = ownSkills["path"] ?? sharedSkills["path"];
      merged.skills = {
        ...(path !== undefined && { path }),
        ...(Object.hasOwn(ownSkills, "mappings") && { mappings: ownSkills["mappings"] }),
      };
    }
    return merged;
  }

  /**
   * The named project, or the only one when no name is given.
   *
   * @throws {@link CatalogError} when the name is unknown, or none is given and there is not exactly one.
   */
  project(name: string | null | undefined): ProjectSpec {
    if (typeof name === "string" && name !== "") {
      const found = this.projects.get(name);
      if (found === undefined) {
        throw new CatalogError(
          `No project named ${show(name)} in ${this.source}. Defined: ${this.definedProjects()}`,
        );
      }
      return found;
    }
    const only = this.projects.values().toArray();
    if (only.length === 1 && only[0] !== undefined) return only[0];
    const defined = show(sortedByCodePoint(this.projects.keys()));
    throw new CatalogError(
      `${this.source} defines ${this.projects.size} projects (${defined}); choose one with --project.`,
    );
  }

  private definedProjects(): string {
    return this.projects.size > 0 ? show(sortedByCodePoint(this.projects.keys())) : "(none)";
  }
}
