/**
 * One changed file as a diff source reports it: the raw record and its validated form.
 * @packageDocumentation
 */

import { hasContent } from "../util/json";

/** A changed-file record before validation; a source may omit any field. */
export interface ChangedFileRecord {
  readonly filename?: unknown;
  readonly status?: unknown;
  readonly patch?: unknown;
}

/** A validated changed-file record. */
export interface ChangedFileEntry {
  /** The repository-relative path. */
  readonly filename: string;
  /** `added`, `modified`, `renamed`, `removed`, … in the source's own words. */
  readonly status: string;
  /** The unified-diff patch, possibly headerless. */
  readonly patch: string;
}

/** A validated changed file. */
export class ChangedFile implements ChangedFileEntry {
  constructor(
    readonly filename: string,
    readonly status: string,
    readonly patch: string,
  ) {}

  /** The repository-relative path. */
  get path(): string {
    return this.filename;
  }

  /**
   * Builds a `ChangedFile` from a raw record.
   *
   * @param entry - The record as the source reported it.
   * @returns The file, or `null` when it has no path or no patch.
   */
  static fromEntry(entry: ChangedFileRecord): ChangedFile | null {
    if (!hasContent(entry.filename) || !hasContent(entry.patch)) return null;
    const status = hasContent(entry.status) ? String(entry.status) : "";
    return new ChangedFile(String(entry.filename), status, String(entry.patch));
  }
}

/**
 * Statuses with no commentable added lines; never reviewed.
 *
 * @remarks `renamed` is not among them. A rename git reports with hunks was edited as it moved -- git pairs
 * files down to 50% similarity -- and the edit is the change. A rename with no hunks has no added lines and
 * is skipped as such.
 */
export const SKIP_STATUSES: ReadonlySet<string> = new Set(["removed"]);
