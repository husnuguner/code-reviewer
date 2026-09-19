/**
 * The config-files port: what `init` needs from the disk.
 * @packageDocumentation
 */

/** Which home a config file is: a repository's `.review/`, or this machine's `~/.config/reviewer`. */
export type ConfigHome = "repo" | "machine";

/** Where the config file and its sibling files are written. */
export interface ConfigDirectory {
  /** The config file's resolved path. */
  readonly path: string;
  /** Which home this is. */
  readonly home: ConfigHome;
  /** The directory holding the config file. */
  readonly directory: string;
  /** The machine's config home, for the hint about where `.env` belongs. */
  readonly configHome: string;
  /** Whether the config file already exists. */
  exists(): boolean;
  /** Writes the config file, creating parent directories. */
  write(text: string): void;
  /** Writes a file beside the config file, creating parents. */
  writeSidecar(relative: string, text: string): void;
  /** Whether a file beside the config file exists. */
  sidecarExists(relative: string): boolean;
}
