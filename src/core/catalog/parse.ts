/**
 * Validating a decoded `config.yaml` into a `Catalog`.
 *
 * A key the schema does not recognise is **rejected**, not ignored: a misspelt
 * `exlude` that silently does nothing would leave a run looking configured
 * when it is not. A key from an earlier schema is answered with its new name,
 * and a key from the posting era is answered with what replaced it. The root
 * object stays open so that notes can live beside the data.
 *
 * The value types stay `unknown` on purpose: the file is read the way an
 * operator wrote it and the run's settings schema does the typing, so a wrong
 * value is reported once, where it is interpreted. What is enforced here is
 * the *shape* -- which keys may exist -- because that is the mistake nothing
 * later would notice.
 *
 * This module only validates. Reading the file is the providers layer's;
 * what a project's settings mean is the resolver's.
 */

import { z } from "zod";

import { CatalogError } from "../util/errors";
import { hasContent, isInteger, isPlainObject, typeNameOf } from "../util/json";
import { show, sortedByCodePoint } from "../util/text";

import { Catalog, type ProjectSettings, type ProjectSpec } from "./catalog";
import {
  LLM_SECTION_KEYS,
  PROJECT_SETTING_KEYS,
  type ProjectSettingKey,
  REMOVED_PROJECT_KEYS,
  REMOVED_ROOT_KEYS,
  REMOVED_SETTING_KEYS,
  RENAMED_LLM_KEYS,
  RENAMED_SETTING_KEYS,
  SCHEMA_VERSION,
  SKILLS_SECTION_KEYS,
} from "./schema";

// -- shape --------------------------------------------------------------------

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

// -- reading ------------------------------------------------------------------

/** `_require_mapping`: the value as an object, or the error the file deserves. */
function requireObject(value: unknown, what: string): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new CatalogError(`${what} must be an object, got ${typeNameOf(value)}`);
  }
  return value;
}

/**
 * The value as a section object, or the error the file deserves. A falsy
 * value (`null`, `[]`, `""`) reads as an empty section, like Python's `or {}`.
 */
function requireSection(value: unknown, what: string): Record<string, unknown> {
  return hasContent(value) ? requireObject(value, what) : {};
}

/** Validate a decoded catalogue body into a `Catalog`. */
export function parseCatalog(payload: unknown, source: string): Catalog {
  const root = requireObject(payload, "config.yaml");

  const version = Object.hasOwn(root, "version") ? root["version"] : SCHEMA_VERSION;
  // Python's `bool` is an `int`, so `true` reads as 1 here as it does there.
  const versionNumber = typeof version === "boolean" ? Number(version) : version;
  if (!isInteger(versionNumber) || versionNumber > SCHEMA_VERSION) {
    throw new CatalogError(
      `${source} declares schema version ${show(version)}, but this build understands up to ${SCHEMA_VERSION}. Upgrade the reviewer.`,
    );
  }

  // The root stays open for notes, so a section this build no longer has
  // would otherwise be ignored in silence -- and a file that still describes
  // a hosting system describes a run this build will not make.
  for (const [gone, instead] of Object.entries(REMOVED_ROOT_KEYS)) {
    if (Object.hasOwn(root, gone)) {
      throw new CatalogError(
        `${source}: ${show(gone)} was removed in schema version ${SCHEMA_VERSION}: ${instead}.`,
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
  rejectUnknownKeys(PROJECT_SECTION, entry, `Project ${show(name)}`);
  validateSections(entry, `Project ${show(name)}`, SKILLS_SECTION);
  return { name, settings: settingsOf(entry) };
}

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
      `${what}: ${show(renamed)} was renamed to ${show(section.renamed?.[renamed])} in schema version ${SCHEMA_VERSION}.`,
    );
  }
  // A key the posting era owned is answered with what replaced it. Asked
  // before the generic "unrecognised" message because that one reads like a
  // typo, and this is not one: the operator wrote a key that used to work.
  const removed = unknown.find((key) => Object.hasOwn(section.removed ?? {}, key));
  if (removed !== undefined) {
    const instead = section.removed?.[removed] ?? "remove it";
    throw new CatalogError(
      `${what}: ${show(removed)} was removed in schema version ${SCHEMA_VERSION}: ${instead}.`,
    );
  }
  const known = sortedByCodePoint(section.known ?? Object.keys(section.schema.shape));
  throw new CatalogError(
    `${what} has unrecognised ${section.noun}(s) ${show(sortedByCodePoint(unknown))}; known: ${show(known)}`,
  );
}
