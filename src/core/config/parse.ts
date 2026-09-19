/**
 * The checks on a decoded `config.yaml` that are the reviewer's policy, not its schema: the version, where a
 * setting may be written, and what the machine's file may not say. Unknown keys and value types are convict's.
 * @packageDocumentation
 */

import { type ConfigHome } from "../ports/config-directory";
import { ConfigFileError } from "../util/errors";
import { isInteger, isPlainObject, typeNameOf } from "../util/json";
import { show, sortedByCodePoint } from "../util/text";

import { type ConfigFile } from "./config-file";
import { REPO_ONLY_KEYS, SCHEMA_VERSION, SETTINGS_SECTION_KEYS } from "./schema";

/** The repository-only keys, for the machine file's error. */
const REPO_ONLY: ReadonlySet<string> = new Set(REPO_ONLY_KEYS);
/** The `settings` section's keys, for the hint when one is written at the root. */
const SETTINGS_KEYS: ReadonlySet<string> = new Set(SETTINGS_SECTION_KEYS);

/**
 * Checks a decoded `config.yaml` and wraps it as a file.
 *
 * @param payload - The decoded YAML.
 * @param source - The file's path, for messages.
 * @param home - Which home the file is; the machine's may not set a repository-only key.
 * @returns The file as a value, its content as written.
 * @throws {@link ConfigFileError} when the root is not an object, the schema version is newer than this build,
 * a setting is written at the root, or the machine's file sets a repository-only key.
 */
export function parseConfigFile(payload: unknown, source: string, home: ConfigHome): ConfigFile {
  if (!isPlainObject(payload)) {
    throw new ConfigFileError(`${source} must be an object, got ${typeNameOf(payload)}`);
  }
  const version = Object.hasOwn(payload, "version") ? payload["version"] : SCHEMA_VERSION;
  const versionNumber = typeof version === "boolean" ? Number(version) : version;
  if (!isInteger(versionNumber) || versionNumber > SCHEMA_VERSION) {
    throw new ConfigFileError(
      `${source} declares schema version ${show(version)}, but this build understands up to ${SCHEMA_VERSION}. Upgrade the reviewer.`,
    );
  }
  const misplaced = sortedByCodePoint(Object.keys(payload).filter((key) => SETTINGS_KEYS.has(key)));
  if (misplaced.length > 0) {
    throw new ConfigFileError(
      `${source} has ${show(misplaced)} at the root; a setting goes under the settings section.`,
    );
  }
  if (home === "machine") {
    const found = sortedByCodePoint(Object.keys(payload).filter((key) => REPO_ONLY.has(key)));
    if (found.length > 0) {
      throw new ConfigFileError(
        `${source} sets ${show(found)}, which belongs to a repository's .review/config.yaml: it describes the reviewed code, not this machine.`,
      );
    }
  }
  return { source, home, values: payload };
}
