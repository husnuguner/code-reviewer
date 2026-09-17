/**
 * How findings look when written down.
 *
 * Rendering has no opinion about what a flow decided; it takes the decision
 * and gives it a shape. Keeping it apart from the flow is what lets the flow
 * be read as a sequence of decisions rather than a sequence of strings.
 */

import { compareCodePoints } from "../util/py";

import { type FileDecision, isSelected, skipCounts, skipDetail } from "./selection";
import { severityLabel } from "./severity";

/** One finding as a line of terminal output (no fix example). */
export function textBody(severity: string, body: string): string {
  return `**[${severityLabel(severity)}]** ${body}`;
}

/**
 * What `--preview` prints instead of reviewing: every changed file, whether
 * it would be reviewed, and why not when it would not be.
 *
 * The table is the whole report -- no model was called, so there is nothing
 * else to say -- and the closing line says so, because "0 findings" and "no
 * model was asked" are answers a reader must not confuse.
 *
 * Files to review come first, then the skipped ones, each block by path, so
 * two previews of the same change set are comparable line for line.
 */
export function previewReport(
  title: string,
  decisions: readonly FileDecision[],
  maxFileChars: number,
): string {
  const ordered = [...decisions].toSorted(
    (a, b) => Number(isSelected(b)) - Number(isSelected(a)) || compareCodePoints(a.path, b.path),
  );
  const reviewing = ordered.filter((decision) => isSelected(decision));
  const width = Math.min(Math.max(0, ...ordered.map((d) => d.path.length)), 60);

  const rows = ordered.map((decision) => {
    const verb = isSelected(decision) ? "review" : "skipped";
    const detail = isSelected(decision)
      ? `+${decision.addedLines.size}${decision.truncated ? ` (diff cut at ${maxFileChars} of ${decision.diffChars} chars)` : ""}`
      : skipDetail(decision);
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
