/**
 * The catalogue-files port: what `init` and `add` need from the disk.
 * @packageDocumentation
 */

/** Which home a catalogue is: a repository's `.review/`, or this machine's `~/.config/reviewer`. */
export type CatalogHome = "repo" | "machine";

/** Where the catalogue and its sibling files are written. */
export interface CatalogFiles {
  /** The catalogue's resolved path. */
  readonly path: string;
  /** Which home this is. */
  readonly home: CatalogHome;
  /** The directory holding the catalogue. */
  readonly directory: string;
  /** The machine's config home, for the hint about where `.env` belongs. */
  readonly configHome: string;
  /** Whether the catalogue already exists. */
  exists(): boolean;
  /** Writes the catalogue, creating parent directories. */
  write(text: string): void;
  /** Adds one project to the catalogue, preserving every comment in the file. */
  addProject(name: string, entry: Readonly<Record<string, unknown>>): void;
  /** The absolute directory of a project's skills. */
  skillsDirectory(project: string): string;
  /** Creates that directory; `true` when it was not already there. */
  createSkillsDirectory(project: string): boolean;
  /** Writes a file beside the catalogue, creating parents. */
  writeSidecar(relative: string, text: string): void;
  /** Whether a file beside the catalogue exists. */
  sidecarExists(relative: string): boolean;
}
