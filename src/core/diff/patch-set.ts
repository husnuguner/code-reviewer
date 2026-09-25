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
 * @returns One entry per file git names, each with its status: a removed file, a binary one, a pure rename
 * and a mode change included. Whether any of them is reviewed is selection's decision, which gives each a
 * reason; dropping them here made them vanish from the counts, and a removed policy file from the warning.
 */
export function splitPatches(raw: string): ChangedFileEntry[] {
  return raw.trim() === ""
    ? []
    : parseUnifiedDiff(raw).map((file) => ({
        filename: file.path,
        status: statusOf(file),
        patch: renderPatchedFile(file),
        ...(file.isRename && { previousFilename: file.sourceFile }),
      }));
}

/** The status word for one changed file: `added`, `removed`, `renamed` or `modified`. */
function statusOf(file: PatchedFile): string {
  if (file.isAddedFile) return "added";
  if (file.isRemovedFile) return "removed";
  return file.isRename ? "renamed" : "modified";
}
