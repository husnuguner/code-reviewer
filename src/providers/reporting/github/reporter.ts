/**
 * GitHub Actions output: findings as `::error`/`::warning` workflow commands on stdout, and a Markdown
 * table in the job summary. Needs no write permission.
 * @packageDocumentation
 */

import {
  type FindingRecord,
  type LineWriter,
  type SummaryRecord,
  type SummaryWriter,
} from "../../../core/ports/review-reporter";
import { bypassAddedWarning, bypassWarning } from "../../../core/review/bypass";
import { policyWarning } from "../../../core/review/policy";
import { incrementalNote } from "../../../core/review/render";
import { severityLabel, severityRankOf } from "../../../core/review/severity";
import { compareCodePoints } from "../../../core/util/text";
import { escapeData, escapeProperty } from "../../../lib/github-actions/workflow-commands";
import { type CollectedFinding, CollectingReporter } from "../collecting";

/** Severities shown as errors; the rest are warnings. Neither fails the job: that is `--fail-on`. */
const ERROR_SEVERITIES: ReadonlySet<string> = new Set(["bug", "security"]);

/**
 * One finding as a workflow command.
 *
 * @returns The `::error`/`::warning` line, or `null` for an unanchored finding (the summary still carries it).
 */
export function annotationFor(finding: Omit<FindingRecord, "type">): string | null {
  if (finding.line === null) return null;
  const level = ERROR_SEVERITIES.has(finding.severity.toLowerCase()) ? "error" : "warning";
  const properties = [
    `file=${escapeProperty(finding.path)}`,
    ...(finding.start_line === null ? [] : [`line=${finding.start_line}`]),
    finding.start_line === null ? `line=${finding.line}` : `endLine=${finding.line}`,
    `title=${escapeProperty(`${severityLabel(finding.severity)} (code-reviewer)`)}`,
  ];
  const example = finding.example === "" ? "" : `\n\n${finding.example}`;
  return `::${level} ${properties.join(",")}::${escapeData(finding.body + example)}`;
}

/**
 * Markdown for the job summary: a severity-sorted table of every finding, then the run's tallies. A change
 * that edits the review policy, or that bypasses its own review with markers, is called out first.
 *
 * @remarks Unanchored findings are listed as `(no line)`, never dropped.
 */
export function summaryFor(
  findings: readonly Omit<FindingRecord, "type">[],
  summary: SummaryRecord | null,
): string {
  const lines = ["## Code review", ""];
  if (summary?.incremental === true) lines.push(`> ${incrementalNote(`\`${summary.base}\``)}`, "");
  const policy = policyWarning(summary?.policy_changed ?? []);
  if (policy !== "") lines.push(`> **${policy}**`, "");
  const bypass = bypassWarning(summary?.bypass_regions ?? []);
  if (bypass !== "") lines.push(`> **${bypass}**`, "");
  const requested = bypassAddedWarning(summary?.bypass_added ?? []);
  if (requested !== "") lines.push(`> **${requested}**`, "");
  const failed = summary?.failed ?? 0;
  if (failed > 0) {
    lines.push(
      `> **Review incomplete: ${failed} file(s) could not be reviewed; the log says why.**`,
      "",
    );
  }
  if (findings.length === 0) {
    lines.push(
      failed > 0
        ? "No issues found in the files that were reviewed."
        : "No issues found in the reviewed files.",
      "",
    );
  } else {
    const files = new Set(findings.map((f) => f.path)).size;
    lines.push(
      `**${findings.length} finding(s)** across **${files} file(s)**.`,
      "",
      "| Severity | Where | Finding |",
      "| --- | --- | --- |",
    );
    const ordered = findings.toSorted(
      (a, b) =>
        severityRankOf(a.severity) - severityRankOf(b.severity) ||
        compareCodePoints(a.path, b.path) ||
        (a.line ?? 0) - (b.line ?? 0),
    );
    for (const finding of ordered) {
      const where =
        finding.line === null ? `${finding.path} (no line)` : `${finding.path}:${finding.line}`;
      lines.push(`| ${severityLabel(finding.severity)} | \`${where}\` | ${cell(finding.body)} |`);
    }
    lines.push("");
  }
  if (summary !== null) {
    lines.push(
      `<sub>${summary.files_reviewed} of ${summary.files_changed} changed file(s) reviewed against \`${summary.base}\`` +
        (summary.failed > 0 ? `; ${summary.failed} could not be reviewed` : "") +
        (summary.refuted > 0 ? `; ${summary.refuted} finding(s) refuted by verification` : "") +
        (summary.capped > 0 ? `; ${summary.capped} withheld by max-findings-per-file` : "") +
        (summary.bypassed > 0
          ? `; ${summary.bypassed} added line(s) in bypassed regions not reviewed`
          : "") +
        (summary.mislabelled > 0
          ? `; ${summary.mislabelled} reported under a severity the model invented`
          : "") +
        `${summary.unanchored > 0 ? `; ${summary.unanchored} without a line anchor` : ""}.</sub>`,
      "",
    );
  }
  return lines.join("\n");
}

/** A body as a table cell: one line, pipes escaped. */
function cell(body: string): string {
  return body.replaceAll("|", "\\|").replaceAll("\n", " ").trim();
}

/** Appends the job summary; injectable so a test needs no filesystem. */
export type SummarySink = SummaryWriter;

/** Streams annotations as findings arrive; writes the summary table on the closing record. */
export class GithubReporter extends CollectingReporter {
  constructor(
    private readonly write: LineWriter,
    private readonly writeSummary: SummarySink | null = null,
  ) {
    super();
  }

  protected override onFinding(finding: CollectedFinding): void {
    const annotation = annotationFor(finding);
    if (annotation !== null) this.write(annotation);
  }

  /** Writes the summary; nothing outside a runner. */
  protected onSummary(summary: SummaryRecord): void {
    if (this.writeSummary === null) return;
    this.writeSummary(summaryFor(this.findings, summary));
  }
}
