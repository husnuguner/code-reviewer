/**
 * The review policy a repository carries -- its config file, standing instructions and skills -- is read
 * as instructions, not as data, so a change set that edits it can weaken the review that reads it. This
 * module says which changed files are policy; the flow reports them and the poster warns.
 * @packageDocumentation
 */

import { type ChangedFileEntry } from "../domain/changed-file";
import { sortedByCodePoint, trimSlashes } from "../util/text";

/** The directory a repository keeps its policy in, as every checkout spells it. */
export const POLICY_DIR = ".review";

/**
 * A repository-relative path that is policy: a directory (its every file) or one file.
 *
 * @remarks Forward slashes, no leading `./` or trailing `/`; {@link normalisePolicyPath} spells one so.
 */
export type PolicyPath = string;

/** One path as {@link PolicyPath} spells it, or `""` for a path that names nothing inside the checkout. */
export function normalisePolicyPath(path: string): PolicyPath {
  const forward = path.trim().replaceAll("\\", "/");
  const trimmed = trimSlashes(forward.startsWith("./") ? forward.slice(2) : forward);
  return trimmed === "." ? "" : trimmed;
}

/** Whether `file` is `policy` itself or lies under it. */
function isUnder(file: string, policy: PolicyPath): boolean {
  return file === policy || file.startsWith(`${policy}/`);
}

/**
 * The changed files that are policy, in code-point order, each once.
 *
 * @param files - The whole change set, before selection: an excluded, removed or renamed policy file is still
 * a changed one, and a rename names both of its paths.
 * @param policyPaths - Where this run's policy lives inside the checkout; `.review` is always among them.
 */
export function policyChanges(
  files: readonly ChangedFileEntry[],
  policyPaths: readonly PolicyPath[],
): string[] {
  const roots = new Set(
    [POLICY_DIR, ...policyPaths].map(normalisePolicyPath).filter((path) => path !== ""),
  );
  const changed = new Set<string>();
  for (const file of files) {
    // A rename changes both paths: moving a skill out of `.review/` removes it from the policy.
    const touched = [
      file.filename,
      ...(file.previousFilename === undefined ? [] : [file.previousFilename]),
    ];
    for (const spelled of touched) {
      const path = normalisePolicyPath(spelled);
      if (path !== "" && [...roots].some((root) => isUnder(path, root))) changed.add(path);
    }
  }
  return sortedByCodePoint(changed);
}

/** The one-line warning every report carries when policy changed; `""` when nothing did. */
export function policyWarning(changed: readonly string[]): string {
  return changed.length === 0
    ? ""
    : `This change edits the review policy (${changed.join(", ")}); a policy can weaken the review that reads it, so read those files yourself.`;
}
