/**
 * The catalogue as a value: what `config.yaml` says once it has been read.
 *
 * The catalogue names two things. **`defaults`** are the settings every
 * project starts from -- the model, the review policy, the skills directory,
 * what is excluded, how much one file may report; and **`projects`** are
 * reviewable targets, each a local checkout plus the defaults it overrides.
 * `--project <name>` selects one, and exactly one is in scope for a run.
 *
 * A project is not a repository on a hosting system. This reviewer reads
 * local git and reports; nothing here describes a connection, a credential
 * or a place to post to, because there is no longer anything to connect to
 * (see README, "Why the reviewer cannot post").
 *
 * This module is the model and the two questions asked of it: a project's
 * settings with the defaults underneath, and which project a name (or no
 * name) means. Validating the file into one is `parse.ts`; merging with the
 * environment and the command line is the resolver's, so the precedence rule
 * lives in exactly one place.
 */

import { CatalogError } from "../util/errors";
import { isPlainObject } from "../util/json";
import { show, sortedByCodePoint } from "../util/text";

import { type ProjectSettingKey } from "./schema";

/** Raw setting values as written; the run's settings schema types them later. */
export type ProjectSettings = Readonly<Partial<Record<ProjectSettingKey, unknown>>>;

/** One reviewable target: a local checkout plus the rules that apply to it. */
export interface ProjectSpec {
  readonly name: string;
  /** The project's own settings, as written -- not yet merged with `defaults`. */
  readonly settings: ProjectSettings;
}

/** The value as an object section, or nothing. */
function sectionOf(value: unknown): Record<string, unknown> | undefined {
  return isPlainObject(value) ? value : undefined;
}

/** A parsed catalogue. */
export class Catalog {
  constructor(
    readonly source: string,
    readonly projects: ReadonlyMap<string, ProjectSpec>,
    /** The root `defaults` section: what every project starts from. */
    readonly defaults: ProjectSettings = {},
  ) {}

  /**
   * A project's settings with the catalogue's `defaults` underneath: a key
   * the project sets wins, one it leaves out falls through. Two sections
   * merge one level deeper -- `llm` key by key, and `skills`, where the
   * directory (`path`) may come from the defaults while the `mappings` are
   * always the project's own.
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

  /** The named project, or the only one when a name is not given. */
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
