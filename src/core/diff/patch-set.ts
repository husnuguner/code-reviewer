/**
 * Splitting a multi-file `git diff` into per-file provider-shaped entries.
 *
 * Output deliberately mirrors what a repo provider's `changedFiles` returns
 * (`filename` / `status` / `patch`), so the per-file review loop cannot tell
 * the two sources apart. Reading the diff out of git is an infrastructure
 * concern (`infra/git`); the splitting is pure and lives here.
 */

import { type ChangedFileEntry } from "../domain/changed-file";

import { type PatchedFile, parseUnifiedDiff, renderPatchedFile } from "./unified-diff";

/**
 * Split a multi-file unified diff into per-file entries.
 *
 * A removed file is dropped, and so is a file git reports with no textual
 * hunks (a pure rename, a mode change, a binary blob): there are no added
 * lines to anchor a finding to, so a review of it could only be noise.
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

/** The provider-shaped status word for one changed file. */
function statusOf(file: PatchedFile): string {
  if (file.isAddedFile) return "added";
  return file.isRename ? "renamed" : "modified";
}
