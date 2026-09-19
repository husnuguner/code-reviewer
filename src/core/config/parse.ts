/**
 * Validates a decoded `config.yaml` into a `ConfigFile`. Unknown keys are rejected; value types are left to the
 * settings schema.
 * @packageDocumentation
 */

import { z } from "zod";

import { type ConfigHome } from "../ports/config-directory";
import { ConfigFileError } from "../util/errors";
import { isInteger, isPlainObject, typeNameOf } from "../util/json";
import { show, sortedByCodePoint } from "../util/text";

import { type ConfigFile, type SettingValues } from "./config-file";
import {
  LLM_SECTION_KEYS,
  REPO_ONLY_KEYS,
  ROOT_KEYS,
  SCHEMA_VERSION,
  SETTINGS_SECTION_KEYS,
  SKILLS_SECTION_KEYS,
  type SettingKey,
} from "./schema";

// -- shape --------------------------------------------------------------------

function shapeOf(keys: readonly string[]): Record<string, z.ZodOptional<z.ZodUnknown>> {
  return Object.fromEntries(keys.map((key) => [key, z.unknown().optional()]));
}

/** The root: `version` plus the two sections. */
const RootSchema = z.strictObject({ version: z.unknown().optional(), ...shapeOf(ROOT_KEYS) });
const SettingsSchema = z.strictObject(shapeOf(SETTINGS_SECTION_KEYS));
const SkillsSchema = z.strictObject(shapeOf(SKILLS_SECTION_KEYS));
const LlmSchema = z.strictObject(shapeOf(LLM_SECTION_KEYS));

/** One strict section: what it accepts and how its error reads. */
interface Section {
  readonly schema: z.ZodObject;
  /** How a key is called in this section's error. */
  readonly noun: "setting" | "key";
  /** The keys named as known in that error; defaults to the schema's own. */
  readonly known?: readonly string[];
}

const ROOT_SECTION: Section = { schema: RootSchema, noun: "key", known: ROOT_KEYS };
const SETTINGS_SECTION: Section = {
  schema: SettingsSchema,
  noun: "setting",
  known: SETTINGS_SECTION_KEYS,
};
const SKILLS_SECTION: Section = { schema: SkillsSchema, noun: "key" };
const LLM_SECTION: Section = { schema: LlmSchema, noun: "key" };

/** The repository-only keys, for the machine file's error. */
const REPO_ONLY: ReadonlySet<string> = new Set(REPO_ONLY_KEYS);
/** The `settings` section's keys, for the hint when one is written at the root. */
const SETTINGS_KEYS: ReadonlySet<string> = new Set(SETTINGS_SECTION_KEYS);

// -- reading ------------------------------------------------------------------

/** The value as an object, or a `ConfigFileError` naming what it should have been. */
function requireObject(value: unknown, what: string): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new ConfigFileError(`${what} must be an object, got ${typeNameOf(value)}`);
  }
  return value;
}

/**
 * Validates a decoded `config.yaml`.
 *
 * @param payload - The decoded YAML.
 * @param source - The file's path, for messages.
 * @param home - Which home the file is; the machine's may not set a repository-only key.
 * @returns The file as a value, its `settings` section flattened beside `skills`.
 * @throws {@link ConfigFileError} on a wrong shape, an unknown key, a newer schema version, or a repository-only
 * key in the machine's file.
 */
export function parseConfigFile(payload: unknown, source: string, home: ConfigHome): ConfigFile {
  const root = requireObject(payload, source);

  const version = Object.hasOwn(root, "version") ? root["version"] : SCHEMA_VERSION;
  const versionNumber = typeof version === "boolean" ? Number(version) : version;
  if (!isInteger(versionNumber) || versionNumber > SCHEMA_VERSION) {
    throw new ConfigFileError(
      `${source} declares schema version ${show(version)}, but this build understands up to ${SCHEMA_VERSION}. Upgrade the reviewer.`,
    );
  }

  rejectSettingsAtRoot(root, source);
  rejectUnknownKeys(ROOT_SECTION, root, source);
  if (home === "machine") rejectRepoOnlyKeys(root, source);

  const settings = Object.hasOwn(root, "settings")
    ? requireObject(root["settings"], `${source}: settings`)
    : {};
  rejectUnknownKeys(SETTINGS_SECTION, settings, `${source}: settings`);
  if (Object.hasOwn(settings, "llm")) {
    const what = `${source}: settings.llm`;
    rejectUnknownKeys(LLM_SECTION, requireObject(settings["llm"], what), what);
  }
  if (Object.hasOwn(root, "skills")) {
    const what = `${source}: skills`;
    rejectUnknownKeys(SKILLS_SECTION, requireObject(root["skills"], what), what);
  }

  return { source, home, values: valuesOf(settings, root) };
}

/** The file's values as one flat set: the `settings` section's keys, then `skills` from the root. */
function valuesOf(settings: Record<string, unknown>, root: Record<string, unknown>): SettingValues {
  const values: Partial<Record<SettingKey, unknown>> = {};
  for (const key of SETTINGS_SECTION_KEYS) {
    if (Object.hasOwn(settings, key)) values[key] = settings[key];
  }
  if (Object.hasOwn(root, "skills")) values.skills = root["skills"];
  return values;
}

/** Throws a `ConfigFileError` pointing at `settings` when one of its keys was written at the root. */
function rejectSettingsAtRoot(root: Record<string, unknown>, source: string): void {
  const misplaced = sortedByCodePoint(Object.keys(root).filter((key) => SETTINGS_KEYS.has(key)));
  if (misplaced.length === 0) return;
  throw new ConfigFileError(
    `${source} has ${show(misplaced)} at the root; a setting goes under the settings section.`,
  );
}

/** Throws a `ConfigFileError` when the machine's file sets a key that describes a repository. */
function rejectRepoOnlyKeys(root: Record<string, unknown>, source: string): void {
  const found = sortedByCodePoint(Object.keys(root).filter((key) => REPO_ONLY.has(key)));
  if (found.length === 0) return;
  throw new ConfigFileError(
    `${source} sets ${show(found)}, which belongs to a repository's .review/config.yaml: it describes the reviewed code, not this machine.`,
  );
}

/** Throws a `ConfigFileError` naming any key the section does not declare, and the accepted set. */
function rejectUnknownKeys(section: Section, entry: Record<string, unknown>, what: string): void {
  const result = section.schema.safeParse(entry);
  if (result.success) return;
  const unknown = result.error.issues.flatMap((issue) =>
    issue.code === "unrecognized_keys" ? issue.keys : [],
  );
  if (unknown.length === 0) return;
  const known = sortedByCodePoint(section.known ?? Object.keys(section.schema.shape));
  throw new ConfigFileError(
    `${what} has unrecognised ${section.noun}(s) ${show(sortedByCodePoint(unknown))}; known: ${show(known)}`,
  );
}
