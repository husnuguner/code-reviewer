/**
 * The catalogue: `config.yaml` validated and flattened.
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
 * (see `docs/adr/0009-local-git-only.md`).
 *
 * One secret may stay out of the file: `llm.api-key` takes either the name of
 * an environment variable (read from the environment and the `.env` files) or
 * the value itself.
 *
 * A key the schema does not recognise is **rejected**, not ignored: a misspelt
 * `exlude` that silently does nothing would leave a run looking configured
 * when it is not. A key from an earlier schema is answered with its new name,
 * and a key from the posting era is answered with what replaced it. The root
 * object stays open so that notes can live beside the data.
 *
 * This module only validates. Reading the file and merging a project with the
 * environment and the command line belong elsewhere, so the precedence rule
 * lives in exactly one place.
 */

import { z } from "zod";

import { CatalogError } from "../util/errors";
import { isDict, isInt, isPyTruthy, pyRepr, pySorted, pyStrip, pyTypeName } from "../util/py";

/**
 * Schema version this build understands. A file from the future is refused
 * with an explanation rather than silently half-read.
 *
 * v3 drops everything about a hosting system: the reviewer reads local git,
 * so `repositories.providers`, a project's `repository` and the posting
 * settings are gone. What remains is YAML with kebab-case keys, a root
 * `defaults` section (with the `llm` settings), `skills: { path, mappings }`,
 * `prompts` (the review-policy files), `language`, `local-path`, and list
 * settings as lists. A v2 file parses unchanged unless it names one of the
 * removed keys, which is answered by name.
 */
export const SCHEMA_VERSION = 3;

/** The setting keys `defaults` and a project accept, as written in the file. */
export const PROJECT_SETTING_KEYS = [
  "llm",
  "language",
  "prompts",
  "verify",
  "skills",
  "local-path",
  "exclude",
  "max-findings-per-file",
  "max-file-chars",
  "max-skill-chars",
  "max-skills-total-chars",
  "max-context-chars",
  "max-concurrent-files",
] as const;

export type ProjectSettingKey = (typeof PROJECT_SETTING_KEYS)[number];

/** The keys of a `skills` section, as written in the file. */
export const SKILLS_SECTION_KEYS = ["path", "mappings"] as const;
export type SkillsSectionKey = (typeof SKILLS_SECTION_KEYS)[number];

/** The keys of an `llm` section, as written in the file. */
export const LLM_SECTION_KEYS = ["provider", "model", "base-url", "api-key"] as const;
export type LlmSectionKey = (typeof LLM_SECTION_KEYS)[number];

// -- earlier spellings, answered with the current one --------------------------

const RENAMED_SETTING_KEYS: Readonly<Record<string, string>> = {
  lang: "language",
  skills_path: "skills.path",
  local_path: "local-path",
  localPath: "local-path",
  max_findings_per_file: "max-findings-per-file",
  maxFindingsPerFile: "max-findings-per-file",
  max_file_chars: "max-file-chars",
  maxFileChars: "max-file-chars",
  max_skill_chars: "max-skill-chars",
  maxSkillChars: "max-skill-chars",
  max_skills_total_chars: "max-skills-total-chars",
  maxSkillsTotalChars: "max-skills-total-chars",
  max_context_chars: "max-context-chars",
  maxContextChars: "max-context-chars",
  max_concurrent_files: "max-concurrent-files",
  maxConcurrentFiles: "max-concurrent-files",
};
const RENAMED_LLM_KEYS: Readonly<Record<string, string>> = {
  baseUrl: "base-url",
  base_url: "base-url",
  apiKey: "api-key",
  api_key: "api-key",
};

/**
 * Keys the posting era owned, and what to do instead.
 *
 * Answered by name rather than as "unrecognised": an operator upgrading a v2
 * file wrote these deliberately, and "unknown setting 'severities'" would
 * read like a typo when the truth is that the feature moved out of the tool.
 */
const REMOVED_SETTING_KEYS: Readonly<Record<string, string>> = {
  severities:
    "this build reports every severity; gate a run with --fail-on instead (see backup/RESTORE.md for the posting flow)",
  "max-prior-comment-chars":
    "there is no prior discussion to read: this build reviews local git and posts nothing",
  "max-concurrent-prs":
    "one branch is reviewed per run; 'max-concurrent-files' is the remaining concurrency knob",
};
const REMOVED_PROJECT_KEYS: Readonly<Record<string, string>> = {
  ...REMOVED_SETTING_KEYS,
  repository:
    "a project is a local checkout now; name it with 'local-path' (see docs/adr/0009-local-git-only.md)",
  repo: "a project is a local checkout now; name it with 'local-path'",
  repo_provider: "this build talks to no hosting system; remove it",
};
const REMOVED_ROOT_KEYS: Readonly<Record<string, string>> = {
  repositories:
    "this build talks to no hosting system: it reads local git and reports (see docs/adr/0009-local-git-only.md)",
  repo_providers: "this build talks to no hosting system; remove it",
};

/** Raw setting values as written; the run's settings schema types them later. */
export type ProjectSettings = Readonly<Partial<Record<ProjectSettingKey, unknown>>>;

/** One reviewable target: a local checkout plus the rules that apply to it. */
export interface ProjectSpec {
  readonly name: string;
  /** The project's own settings, as written -- not yet merged with `defaults`. */
  readonly settings: ProjectSettings;
}

// -- shape --------------------------------------------------------------------
//
// The value types stay `unknown` on purpose: the file is read the way an
// operator wrote it and the run's settings schema does the typing, so a wrong
// value is reported once, where it is interpreted. What is enforced here is the
// *shape* -- which keys may exist -- because that is the mistake nothing later
// would notice.

function shapeOf(keys: readonly string[]): Record<string, z.ZodOptional<z.ZodUnknown>> {
  return Object.fromEntries(keys.map((key) => [key, z.unknown().optional()]));
}

const DefaultsSchema = z.strictObject(shapeOf(PROJECT_SETTING_KEYS));
const ProjectSchema = z.strictObject(shapeOf(PROJECT_SETTING_KEYS));
const SkillsSchema = z.strictObject(shapeOf(SKILLS_SECTION_KEYS));
// `defaults.skills` names the directory only: which files a skill reviews
// depends on a project's layout, so the mappings live on the project.
const DefaultsSkillsSchema = z.strictObject(shapeOf(["path"]));
const LlmSchema = z.strictObject(shapeOf(LLM_SECTION_KEYS));

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
          `No project named ${pyRepr(name)} in ${this.source}. Defined: ${this.definedProjects()}`,
        );
      }
      return found;
    }
    const only = this.projects.values().toArray();
    if (only.length === 1 && only[0] !== undefined) return only[0];
    const defined = pyRepr(pySorted(this.projects.keys()));
    throw new CatalogError(
      `${this.source} defines ${this.projects.size} projects (${defined}); choose one with --project.`,
    );
  }

  private definedProjects(): string {
    return this.projects.size > 0 ? pyRepr(pySorted(this.projects.keys())) : "(none)";
  }
}

// -- secrets -------------------------------------------------------------------

/** Spelled like an environment variable: `LLM_API_KEY`, `ANTHROPIC_API_KEY`. */
const ENVIRONMENT_NAME = /^[A-Z_][A-Z0-9_]*$/u;

/**
 * A secret setting, resolved: a value spelled like an environment variable
 * is the *name* of the variable holding the secret and is read from `lookup`;
 * anything else is the secret itself.
 *
 * `lookup` matters: the documented home for a secret is the `.env` beside the
 * catalogue, whose values the settings loader reads without exporting them to
 * the process environment. A caller that passes only the process environment
 * would reject a correctly placed value.
 *
 * A named variable that is not set is an error, not an empty secret: the
 * operator described an intent the environment does not satisfy, and failing
 * now beats a confusing 401 later. `environmentFile` names where the value
 * should have been, for the message.
 *
 * The one exception is a flow that will never send the secret. `--preview`
 * decides scope and calls nobody, and a pre-flight that refused to run
 * without a key it would never use would be a pre-flight nobody could run
 * before they had one. With `isRequired` false, an unset variable resolves
 * to `""` and the run that does need it fails at *its* boundary instead.
 */
export function resolveSecret(
  value: string,
  lookup: Readonly<Record<string, string | undefined>>,
  what: string,
  environmentFile: string,
  isRequired = true,
): string {
  const spelled = pyStrip(value);
  if (!ENVIRONMENT_NAME.test(spelled)) return spelled;
  const resolved = pyStrip(lookup[spelled] ?? "");
  if (resolved === "" && isRequired) {
    throw new CatalogError(
      `${what} names ${pyRepr(spelled)}, which is not set. Put it in ${environmentFile} or export it.`,
    );
  }
  return resolved;
}

// -- reading ------------------------------------------------------------------

/** The value as an object section, or nothing. */
function sectionOf(value: unknown): Record<string, unknown> | undefined {
  return isDict(value) ? value : undefined;
}

/** `_require_mapping`: the value as an object, or the error the file deserves. */
function requireObject(value: unknown, what: string): Record<string, unknown> {
  if (!isDict(value)) {
    throw new CatalogError(`${what} must be an object, got ${pyTypeName(value)}`);
  }
  return value;
}

/**
 * The value as a section object, or the error the file deserves. A falsy
 * value (`null`, `[]`, `""`) reads as an empty section, like Python's `or {}`.
 */
function requireSection(value: unknown, what: string): Record<string, unknown> {
  return isPyTruthy(value) ? requireObject(value, what) : {};
}

/** Validate a decoded catalogue body into a `Catalog`. */
export function parseCatalog(payload: unknown, source: string): Catalog {
  const root = requireObject(payload, "config.yaml");

  const version = Object.hasOwn(root, "version") ? root["version"] : SCHEMA_VERSION;
  // Python's `bool` is an `int`, so `true` reads as 1 here as it does there.
  const versionNumber = typeof version === "boolean" ? Number(version) : version;
  if (!isInt(versionNumber) || versionNumber > SCHEMA_VERSION) {
    throw new CatalogError(
      `${source} declares schema version ${pyRepr(version)}, but this build understands up to ${SCHEMA_VERSION}. Upgrade the reviewer.`,
    );
  }

  // The root stays open for notes, so a section this build no longer has
  // would otherwise be ignored in silence -- and a file that still describes
  // a hosting system describes a run this build will not make.
  for (const [gone, instead] of Object.entries(REMOVED_ROOT_KEYS)) {
    if (Object.hasOwn(root, gone)) {
      throw new CatalogError(
        `${source}: ${pyRepr(gone)} was removed in schema version ${SCHEMA_VERSION}: ${instead}.`,
      );
    }
  }

  const defaults = requireSection(root["defaults"], "defaults");
  rejectUnknownKeys(DEFAULTS_SECTION, defaults, "defaults");
  validateSections(defaults, "defaults", DEFAULTS_SKILLS_SECTION);

  const projects = new Map<string, ProjectSpec>();
  const rawProjects = requireSection(root["projects"], "projects");
  for (const [name, raw] of Object.entries(rawProjects)) {
    projects.set(name, parseProject(name, requireObject(raw, `projects.${name}`)));
  }

  return new Catalog(source, projects, settingsOf(defaults));
}

/** The known setting keys of a section, as written. */
function settingsOf(entry: Record<string, unknown>): ProjectSettings {
  const settings: Partial<Record<ProjectSettingKey, unknown>> = {};
  for (const key of PROJECT_SETTING_KEYS) {
    if (Object.hasOwn(entry, key)) settings[key] = entry[key];
  }
  return settings;
}

/** The `skills` and `llm` sections of `defaults` or a project, where present. */
function validateSections(
  entry: Record<string, unknown>,
  where: string,
  skillsSection: CatalogSection,
): void {
  if (Object.hasOwn(entry, "skills")) {
    const skills = requireObject(entry["skills"], `${where}.skills`);
    if (skillsSection === DEFAULTS_SKILLS_SECTION && Object.hasOwn(skills, "mappings")) {
      throw new CatalogError(
        "defaults.skills.mappings: which files a skill reviews is set per project (projects.<name>.skills.mappings); defaults only names the directory (skills.path).",
      );
    }
    rejectUnknownKeys(skillsSection, skills, `${where} skills`);
  }
  if (Object.hasOwn(entry, "llm")) {
    rejectUnknownKeys(LLM_SECTION, requireObject(entry["llm"], `${where}.llm`), `${where} llm`);
  }
}

function parseProject(name: string, entry: Record<string, unknown>): ProjectSpec {
  rejectUnknownKeys(PROJECT_SECTION, entry, `Project ${pyRepr(name)}`);
  validateSections(entry, `Project ${pyRepr(name)}`, SKILLS_SECTION);
  return { name, settings: settingsOf(entry) };
}

/** One strict section of the catalogue: what it accepts, and how its error reads. */
interface CatalogSection {
  readonly schema: z.ZodObject;
  /** How a key is called in this section's error message. */
  readonly noun: "setting" | "key";
  /** The keys named as "known" in that message; defaults to the schema's own. */
  readonly known?: readonly string[];
  /** Keys an earlier schema version used, mapped to their current name. */
  readonly renamed?: Readonly<Record<string, string>>;
  /** Keys this build removed, mapped to what to do instead. */
  readonly removed?: Readonly<Record<string, string>>;
}

const DEFAULTS_SECTION: CatalogSection = {
  schema: DefaultsSchema,
  noun: "setting",
  renamed: RENAMED_SETTING_KEYS,
  removed: REMOVED_SETTING_KEYS,
};
const PROJECT_SECTION: CatalogSection = {
  schema: ProjectSchema,
  noun: "setting",
  known: PROJECT_SETTING_KEYS,
  renamed: RENAMED_SETTING_KEYS,
  removed: REMOVED_PROJECT_KEYS,
};
const SKILLS_SECTION: CatalogSection = { schema: SkillsSchema, noun: "key" };
const DEFAULTS_SKILLS_SECTION: CatalogSection = { schema: DefaultsSkillsSchema, noun: "key" };
const LLM_SECTION: CatalogSection = { schema: LlmSchema, noun: "key", renamed: RENAMED_LLM_KEYS };

/**
 * Refuse keys the section does not declare, naming them and the accepted set.
 * The schema decides what is unknown, so the message can never drift from
 * what the parser accepts.
 */
function rejectUnknownKeys(
  section: CatalogSection,
  entry: Record<string, unknown>,
  what: string,
): void {
  const result = section.schema.safeParse(entry);
  if (result.success) return;
  const unknown = result.error.issues.flatMap((issue) =>
    issue.code === "unrecognized_keys" ? issue.keys : [],
  );
  if (unknown.length === 0) return;
  // A key from an older schema gets its new name rather than a puzzle.
  const renamed = unknown.find((key) => Object.hasOwn(section.renamed ?? {}, key));
  if (renamed !== undefined) {
    throw new CatalogError(
      `${what}: ${pyRepr(renamed)} was renamed to ${pyRepr(section.renamed?.[renamed])} in schema version ${SCHEMA_VERSION}.`,
    );
  }
  // A key the posting era owned is answered with what replaced it. Asked
  // before the generic "unrecognised" message because that one reads like a
  // typo, and this is not one: the operator wrote a key that used to work.
  const removed = unknown.find((key) => Object.hasOwn(section.removed ?? {}, key));
  if (removed !== undefined) {
    const instead = section.removed?.[removed] ?? "remove it";
    throw new CatalogError(
      `${what}: ${pyRepr(removed)} was removed in schema version ${SCHEMA_VERSION}: ${instead}.`,
    );
  }
  const known = pySorted(section.known ?? Object.keys(section.schema.shape));
  throw new CatalogError(
    `${what} has unrecognised ${section.noun}(s) ${pyRepr(pySorted(unknown))}; known: ${pyRepr(known)}`,
  );
}
