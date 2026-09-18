/**
 * The catalogue-files port: what `init` and `add` need from the disk.
 *
 * The two commands that write the catalogue decide *what* to write; where a
 * file goes and how YAML is edited in place is behind this interface, so the
 * decisions stay testable without a disk and a UI can plug in its own store.
 */

/**
 * Which home a catalogue is: a repository's own, or this machine's.
 *
 * The distinction decides what `init` writes and what it says. A repository's
 * `.review/` is committed and shared, so it gets a `.gitignore` for its
 * secret and a README for the team; the machine's `~/.config/reviewer` is
 * one person's, and gets neither.
 */
export type CatalogHome = "repo" | "machine";

/** Where the catalogue and its sibling files are written. */
export interface CatalogFiles {
  /** Where the catalogue goes (already resolved from `--config`/env/default). */
  readonly path: string;
  readonly home: CatalogHome;
  /** The directory holding the catalogue, for files that sit beside it. */
  readonly directory: string;
  /** The config home, for the hint about where the `.env` belongs. */
  readonly configHome: string;
  /** Where the review policy goes: `prompts/system.md` beside the catalogue. */
  readonly promptPath: string;
  exists(): boolean;
  /** Write the catalogue, creating parent directories. */
  write(text: string): void;
  promptExists(): boolean;
  /** Write the review policy, creating parent directories. */
  writePrompt(text: string): void;

  /**
   * Add one project to the catalogue, leaving every comment in place.
   *
   * Comment preservation is the requirement, not a nicety: this file is
   * hand-written and annotated, and a command that reformatted it on every
   * use would be a command nobody runs twice.
   */
  addProject(name: string, entry: Readonly<Record<string, unknown>>): void;

  /** Where a project's skills live on this machine, absolute. */
  skillsDirectory(project: string): string;

  /** Create that directory; `true` when it was not already there. */
  createSkillsDirectory(project: string): boolean;

  /** Write a file beside the catalogue (`relative` to its directory), creating parents. */
  writeSidecar(relative: string, text: string): void;

  sidecarExists(relative: string): boolean;
}
