/**
 * A `config.yaml` as a value, and how a repository's sits on top of the machine's.
 * @packageDocumentation
 */

import { type ConfigHome } from "../ports/config-directory";
import { isPlainObject } from "../util/json";

import { type SettingKey } from "./schema";

/** Setting values as written; the settings schema types them later. */
export type SettingValues = Readonly<Partial<Record<SettingKey, unknown>>>;

/** One parsed `config.yaml`. */
export interface ConfigFile {
  /** The file's path, for messages. */
  readonly source: string;
  /** Which home it is: a repository's `.review/`, or the machine's. */
  readonly home: ConfigHome;
  readonly values: SettingValues;
}

/** The value as an object section, or `undefined`. */
function sectionOf(value: unknown): Record<string, unknown> | undefined {
  return isPlainObject(value) ? value : undefined;
}

/**
 * The repository's values on top of the machine's.
 *
 * @returns One set of values: a key the repository restates wins whole, except `llm`, which merges key by key
 * so a repository may pin the model and still take the provider and key from the machine.
 */
export function layerSettings(
  machine: SettingValues | null,
  repo: SettingValues | null,
): SettingValues {
  const below = machine ?? {};
  const above = repo ?? {};
  const merged: Partial<Record<SettingKey, unknown>> = { ...below, ...above };
  const sharedLlm = sectionOf(below.llm);
  const ownLlm = sectionOf(above.llm);
  if (sharedLlm !== undefined || ownLlm !== undefined) {
    merged.llm = { ...sharedLlm, ...ownLlm };
  }
  return merged;
}
