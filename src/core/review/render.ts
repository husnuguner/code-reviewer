/**
 * Text rendering of findings and of the preview.
 * @packageDocumentation
 */

import { compareCodePoints } from "../util/text";

import { type FileDecision, isSelected, skipCounts, skipDetail } from "./selection";
import { severityLabel } from "./severity";

/** One finding as a line of terminal output: `**[Label]** body`. */
export function textBody(severity: string, body: string): string {
  return `**[${severityLabel(severity)}]** ${body}`;
}

/**
 * The `--preview` report: every changed file, whether it would be reviewed, and why not.
 *
 * @param title - The scope, e.g. `branch HEAD vs main`.
 * @param decisions - The selection.
 * @returns Files to review first, then skipped ones, each block by path; closes with "No model was called."
 */
export function previewReport(title: string, decisions: readonly FileDecision[]): string {
  const ordered = [...decisions].toSorted(
    (a, b) => Number(isSelected(b)) - Number(isSelected(a)) || compareCodePoints(a.path, b.path),
  );
  const reviewing = ordered.filter((decision) => isSelected(decision));
  const width = Math.min(Math.max(0, ...ordered.map((d) => d.path.length)), 60);

  const rows = ordered.map((decision) => {
    const verb = isSelected(decision) ? "review" : "skipped";
    const detail = isSelected(decision) ? `+${decision.addedLines.size}` : skipDetail(decision);
    return `  ${verb.padEnd(8)} ${decision.path.padEnd(width)}  ${detail}`.trimEnd();
  });
  const skips = [...skipCounts(decisions)]
    .toSorted(([a], [b]) => compareCodePoints(a, b))
    .map(([reason, n]) => `${reason}=${n}`);

  return [
    `\n=== [PREVIEW] ${title} ===`,
    `${decisions.length} changed file(s); ${reviewing.length} to review, ${decisions.length - reviewing.length} skipped.`,
    ...(rows.length > 0 ? ["", ...rows] : []),
    ...(skips.length > 0 ? ["", `skipped: ${skips.join(", ")}`] : []),
    "No model was called.",
  ].join("\n");
}
