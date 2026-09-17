/**
 * The GitHub Actions adapter: findings as workflow commands and a job summary.
 *
 * This is how a finding reaches a pull request now. The reviewer posts
 * nothing and holds no credential; it *prints*, and the runner turns what it
 * printed into review annotations on the changed lines and a table in the job
 * summary. The consequence is the point: a run needs no `pull-requests:
 * write` permission, cannot spam a conversation, and behaves identically on a
 * laptop and in CI, because in both places it only writes to a stream.
 *
 * Two sinks, on purpose:
 *
 * - **Annotations** (`::warning file=...,line=...::`) go to stdout, where the
 *   runner reads them. They are what puts a finding *on the diff*, beside the
 *   code it is about.
 * - **The job summary** is Markdown appended to `$GITHUB_STEP_SUMMARY`. It is
 *   the whole report, including the findings no annotation could carry --
 *   an unanchored finding has no line to hang on, and dropping it because
 *   GitHub wants a line would lose exactly the findings that are hardest to
 *   place and often the most interesting.
 *
 * Message text is escaped as the workflow-command format requires; an
 * unescaped newline would silently truncate a finding to its first line.
 */

import { type FindingRecord, type SummaryRecord } from "../../core/ports/review-reporter";
import { type LineWriter, type SummaryWriter } from "../../core/reporting/format-registry";
import { severityLabel, severityRankOf } from "../../core/review/severity";
import { compareCodePoints } from "../../core/util/py";

import { type CollectedFinding, CollectingReporter } from "./collecting";

/**
 * Severities the runner should show as errors rather than warnings.
 *
 * A red annotation is a claim that something is wrong, so only the two
 * severities that assert a defect earn one; style and speed notes are
 * warnings. Note that neither fails the job -- that is `--fail-on`'s
 * decision, kept separate so the colour of a note and the fate of a build
 * are not the same knob.
 */
const ERROR_SEVERITIES: ReadonlySet<string> = new Set(["bug", "security"]);

/** Escape a value for the `::cmd key=value::message` format. */
function escapeProperty(value: string): string {
  return value
    .replaceAll("%", "%25")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A")
    .replaceAll(":", "%3A")
    .replaceAll(",", "%2C");
}

/** Escape the message half, where `:` and `,` are legal but newlines are not. */
function escapeData(value: string): string {
  return value.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
}

/** A finding as one `::error`/`::warning` workflow command, or `null`. */
export function annotationFor(finding: Omit<FindingRecord, "type">): string | null {
  // No line, no annotation: GitHub anchors one to a file and a line, and a
  // fabricated line would put the note on unrelated code. The summary still
  // carries it (see `summaryFor`), so nothing is lost by declining here.
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

/** Markdown for the job summary: a table of findings, then the run's tallies. */
export function summaryFor(
  findings: readonly Omit<FindingRecord, "type">[],
  summary: SummaryRecord | null,
): string {
  const lines = ["## Code review", ""];
  if (findings.length === 0) {
    lines.push("No issues found in the reviewed files.", "");
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
      // An unanchored finding says so rather than being dropped: it is the
      // one a reader cannot find by scrolling the diff.
      const where =
        finding.line === null ? `${finding.path} (no line)` : `${finding.path}:${finding.line}`;
      lines.push(`| ${severityLabel(finding.severity)} | \`${where}\` | ${cell(finding.body)} |`);
    }
    lines.push("");
  }
  if (summary !== null) {
    lines.push(
      `<sub>${summary.files_reviewed} of ${summary.files_changed} changed file(s) reviewed against \`${summary.base}\`` +
        (summary.refuted > 0 ? `; ${summary.refuted} finding(s) refuted by verification` : "") +
        (summary.capped > 0 ? `; ${summary.capped} withheld by max-findings-per-file` : "") +
        `${summary.unanchored > 0 ? `; ${summary.unanchored} without a line anchor` : ""}.</sub>`,
      "",
    );
  }
  return lines.join("\n");
}

/** One finding's body as a table cell: single line, pipes escaped. */
function cell(body: string): string {
  return body.replaceAll("|", "\\|").replaceAll("\n", " ").trim();
}

/** Appends the job summary; injected so a test needs no filesystem. */
export type SummarySink = SummaryWriter;

/**
 * Findings as GitHub Actions output.
 *
 * Annotations stream as they arrive -- a long review shows its first finding
 * immediately -- while the summary is held until the closing record, because
 * a table cannot be written before its rows are known.
 */
export class GithubReporter extends CollectingReporter {
  constructor(
    private readonly write: LineWriter,
    private readonly writeSummary: SummarySink | null = null,
  ) {
    super();
  }

  /** Each finding goes out as an annotation the moment it arrives. */
  protected override onFinding(finding: CollectedFinding): void {
    const annotation = annotationFor(finding);
    if (annotation !== null) this.write(annotation);
  }

  /** The job summary, once the rows are known; nowhere to write outside a runner. */
  protected onSummary(summary: SummaryRecord): void {
    if (this.writeSummary === null) return;
    this.writeSummary(summaryFor(this.findings, summary));
  }
}
