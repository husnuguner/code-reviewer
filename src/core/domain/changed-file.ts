/**
 * One changed file as `git diff` reports it.
 *
 * Two shapes, one vocabulary. `ChangedFileRecord` is the *raw* record, every
 * field optional, because a source may omit any of them; `ChangedFileEntry`
 * is the same record once it is known to carry all three. The review step
 * takes the validated one and never learns where it came from, which is what
 * lets a reader (local git today, anything else tomorrow) be swapped without
 * the review knowing.
 */

/**
 * A changed-file record as a diff source reports it, before validation.
 * Every field is optional: a source may omit the patch (a binary or
 * oversized file) or the status.
 */
export interface ChangedFileRecord {
  readonly filename?: unknown;
  readonly status?: unknown;
  readonly patch?: unknown;
}

/** A validated changed-file record: `filename` / `status` / `patch`. */
export interface ChangedFileEntry {
  readonly filename: string;
  /** `added`, `modified`, `renamed`, `removed`, ... in the provider's own words. */
  readonly status: string;
  /** The file's unified-diff patch, possibly headerless. */
  readonly patch: string;
}

/** File statuses that carry no commentable added lines and are never reviewed. */
export const SKIP_STATUSES: ReadonlySet<string> = new Set(["removed", "renamed"]);
