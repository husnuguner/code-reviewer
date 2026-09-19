/**
 * Splits a multi-file `git diff` into per-file changed-file entries.
 * @packageDocumentation
 */

import { type ChangedFileEntry } from "../domain/changed-file";

import { type PatchedFile, parseUnifiedDiff, renderPatchedFile } from "./unified-diff";

/**
 * Splits a multi-file unified diff into per-file entries.
 *
 * @param raw - The whole `git diff` output.
 * @returns One entry per file; removed files and files without textual hunks are dropped.
 */
export function splitPatches(raw: string): ChangedFileEntry[] {
  return raw.trim() === ""
    ? []
    : parseUnifiedDiff(raw)
        .filter((file) => !file.isRemovedFile && file.hunks.length > 0)
        .map((file) => ({
          filename: file.path,
          status: statusOf(file),
          patch: renderPatchedFile(file),
        }));
}

/** The status word for one changed file: `added`, `renamed` or `modified`. */
function statusOf(file: PatchedFile): string {
  if (file.isAddedFile) return "added";
  return file.isRename ? "renamed" : "modified";
}
