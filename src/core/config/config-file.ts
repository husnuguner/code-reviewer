/**
 * One `config.yaml` as read: its path, which home it is, and its values as written, ready for convict to merge.
 * @packageDocumentation
 */

import { type ConfigHome } from "../ports/config-directory";

/** The file's content as a plain object: `settings` and, in a repository's file, `skills`. */
export type SettingValues = Readonly<Record<string, unknown>>;

/** One parsed `config.yaml`. */
export interface ConfigFile {
  /** The file's path, for messages. */
  readonly source: string;
  /** Which home it is: a repository's `.review/`, or the machine's. */
  readonly home: ConfigHome;
  readonly values: SettingValues;
}
