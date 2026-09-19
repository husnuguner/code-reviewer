/**
 * Validates a decoded `config.yaml` into a `Catalog`. Unknown keys are rejected; value types are left to the settings schema.
 * @packageDocumentation
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
/** `defaults.skills` names the directory only; mappings are per project. */
const DefaultsSkillsSchema = z.strictObject(shapeOf(["path"]));
const LlmSchema = z.strictObject(shapeOf(LLM_SECTION_KEYS));

/** One strict section: what it accepts and how its error reads. */
interface CatalogSection {
  readonly schema: z.ZodObject;
  /** How a key is called in this section's error. */
  readonly noun: "setting" | "key";
  /** The keys named as known in that error; defaults to the schema's own. */
  readonly known?: readonly string[];
}

const DEFAULTS_SECTION: CatalogSection = { schema: DefaultsSchema, noun: "setting" };
const PROJECT_SECTION: CatalogSection = {
  schema: ProjectSchema,
  noun: "setting",
  known: PROJECT_SETTING_KEYS,
};
const SKILLS_SECTION: CatalogSection = { schema: SkillsSchema, noun: "key" };
const DEFAULTS_SKILLS_SECTION: CatalogSection = { schema: DefaultsSkillsSchema, noun: "key" };
const LLM_SECTION: CatalogSection = { schema: LlmSchema, noun: "key" };

// -- reading ------------------------------------------------------------------

/** The value as an object, or a `CatalogError` naming what it should have been. */
function requireObject(value: unknown, what: string): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new CatalogError(`${what} must be an object, got ${typeNameOf(value)}`);
  }
  return value;
}

/** The value as a section object; an empty value (`null`, `[]`, `""`) reads as `{}`. */
function requireSection(value: unknown, what: string): Record<string, unknown> {
  return hasContent(value) ? requireObject(value, what) : {};
}

/**
 * Validates a decoded catalogue body.
 *
 * @param payload - The decoded YAML.
 * @param source - The file's path, for messages.
 * @returns The catalogue.
 * @throws {@link CatalogError} on a wrong shape, an unknown key, or a newer schema version.
 */
export function parseCatalog(payload: unknown, source: string): Catalog {
  const root = requireObject(payload, "config.yaml");

  const version = Object.hasOwn(root, "version") ? root["version"] : SCHEMA_VERSION;
  const versionNumber = typeof version === "boolean" ? Number(version) : version;
  if (!isInteger(versionNumber) || versionNumber > SCHEMA_VERSION) {
    throw new CatalogError(
      `${source} declares schema version ${show(version)}, but this build understands up to ${SCHEMA_VERSION}. Upgrade the reviewer.`,
    );
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

/** Validates the `skills` and `llm` sections of `defaults` or a project, where present. */
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

/** Throws a `CatalogError` naming any key the section does not declare, and the accepted set. */
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
  const known = sortedByCodePoint(section.known ?? Object.keys(section.schema.shape));
  throw new CatalogError(
    `${what} has unrecognised ${section.noun}(s) ${show(sortedByCodePoint(unknown))}; known: ${show(known)}`,
  );
}
