/**
 * Turns a run's records into one change-request review. Pure: records in, a payload out.
 * @packageDocumentation
 */

import { type ReviewEvent } from "../ports/review-poster";
import { type FindingRecord, type SummaryRecord } from "../ports/review-reporter";
import { severityGate, severityLabel, severityRankOf } from "../review/severity";
import { type JsonObject, type JsonValue, isJsonArray, isJsonObject } from "../util/json";
import { compareCodePoints } from "../util/text";

/** One finding as the record stream carries it (no `type` discriminator). */
export type Finding = Omit<FindingRecord, "type">;

/** A finding with a line. */
type AnchoredFinding = Finding & { readonly line: number };

/** Whether the finding has a line, narrowing as it answers. */
function isAnchored(finding: Finding): finding is AnchoredFinding {
  return finding.line !== null;
}

/** A run's records, split into what a review is built from. */
export interface ReviewRecords {
  readonly findings: readonly Finding[];
  /** The closing record, or `null` when the stream carried none. */
  readonly summary: SummaryRecord | null;
  /** Lines that were not a record this build understands. */
  readonly unreadable: number;
}

/** One inline comment as a hosting API takes it. */
export interface InlineComment {
  readonly path: string;
  readonly line: number;
  readonly start_line?: number;
  readonly body: string;
}

/** A whole review: the body, its inline comments, and what did not fit. */
export interface ReviewPayload {
  readonly body: string;
  readonly comments: readonly InlineComment[];
  /** Anchored findings the inline cap left out; named in the body. */
  readonly overflow: number;
  /** `request-changes` when any finding's severity is gated, else `comment`. */
  readonly event: ReviewEvent;
}

/** Default cap on inline comments; a review with too many is refused whole by the API. */
export const MAX_INLINE = 50;

/** How many listed findings a collapsed block shows before summarising. */
const MAX_LISTED = 50;

/**
 * Reads a record stream.
 *
 * @param text - NDJSON as `reviewer review --out` wrote it.
 * @returns The findings, the summary, and how many lines could not be read. A bad line costs only itself.
 */
export function parseRecords(text: string): ReviewRecords {
  const findings: Finding[] = [];
  let summary: SummaryRecord | null = null;
  let unreadable = 0;

  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    const record = decodeLine(line);
    if (record === null) {
      unreadable++;
      continue;
    }
    if (record.kind === "finding") findings.push(record.finding);
    else summary = record.summary;
  }
  return { findings, summary, unreadable };
}

type DecodedLine =
  | { readonly kind: "finding"; readonly finding: Finding }
  | { readonly kind: "summary"; readonly summary: SummaryRecord };

/** Decodes and validates one line; every field is narrowed, never asserted. */
function decodeLine(line: string): DecodedLine | null {
  let value: JsonValue;
  try {
    value = JSON.parse(line) as JsonValue;
  } catch {
    return null;
  }
  if (!isJsonObject(value)) return null;
  if (value["type"] === "finding") {
    const finding = toFinding(value);
    return finding === null ? null : { kind: "finding", finding };
  }
  return value["type"] === "summary" ? { kind: "summary", summary: toSummary(value) } : null;
}

function text_(value: JsonValue | undefined, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function count(value: JsonValue | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** A positive line number, or `null`. */
function lineNumber(value: JsonValue | undefined): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

/** A finding, or `null` without a path and a body. */
function toFinding(record: JsonObject): Finding | null {
  const path = text_(record["path"]);
  const body = text_(record["body"]);
  if (path === "" || body === "") return null;
  const skills = record["skills"];
  return {
    path,
    body,
    line: lineNumber(record["line"]),
    start_line: lineNumber(record["start_line"]),
    anchor: text_(record["anchor"]),
    severity: text_(record["severity"], "readability"),
    example: text_(record["example"]),
    skills: isJsonArray(skills)
      ? skills.flatMap((skill) => (typeof skill === "string" ? [skill] : []))
      : [],
  };
}

function toSummary(record: JsonObject): SummaryRecord {
  return {
    type: "summary",
    base: text_(record["base"]),
    branch: text_(record["branch"]),
    files_changed: count(record["files_changed"]),
    files_reviewed: count(record["files_reviewed"]),
    failed: count(record["failed"]),
    truncated: count(record["truncated"]),
    findings: count(record["findings"]),
    files_with_findings: count(record["files_with_findings"]),
    anchors: {},
    unanchored: count(record["unanchored"]),
    refuted: count(record["refuted"]),
    capped: count(record["capped"]),
    mislabelled: count(record["mislabelled"]),
    skipped: {},
  };
}

/**
 * One finding as an inline comment body: label, text, example, skills.
 *
 * @remarks The example is a plain fence, not a `suggestion`: it is illustrative, not a one-click commit.
 */
export function commentBody(finding: Finding): string {
  const head = `**[${severityLabel(finding.severity)}]** ${finding.body}`;
  const example = finding.example === "" ? "" : `\n\n\`\`\`\n${finding.example}\n\`\`\``;
  const skills =
    finding.skills.length === 0 ? "" : `\n\n<sub>skills: ${finding.skills.join(", ")}</sub>`;
  return `${head}${example}${skills}`;
}

/** Most severe first, then by path and line. */
function bySeverityThenPlace(a: Finding, b: Finding): number {
  return (
    severityRankOf(a.severity) - severityRankOf(b.severity) ||
    compareCodePoints(a.path, b.path) ||
    (a.line ?? 0) - (b.line ?? 0)
  );
}

/** Options for {@link buildReview}. */
export interface BuildReviewOptions {
  /** Cap on inline comments; the rest are named in the body. Default {@link MAX_INLINE}. */
  readonly maxInline?: number;
  /** Severities that make the review a request for changes. Empty (default) always posts a comment. */
  readonly requestChangesOn?: readonly string[];
}

/**
 * The review event these findings call for.
 *
 * @param requestChangesOn - The gating severities.
 * @returns `request-changes` when any finding is gated, else `comment`.
 */
export function reviewEventFor(
  findings: readonly Finding[],
  requestChangesOn: readonly string[],
): ReviewEvent {
  const isGated = severityGate(requestChangesOn);
  return findings.some((finding) => isGated(finding.severity)) ? "request-changes" : "comment";
}

/**
 * Builds the review a record stream describes.
 *
 * @returns Anchored findings as inline comments, most severe first, up to the cap; unanchored and
 * overflow findings listed in the body with the run's tallies.
 */
export function buildReview(
  records: ReviewRecords,
  options: BuildReviewOptions = {},
): ReviewPayload {
  const maxInline = options.maxInline ?? MAX_INLINE;
  const ordered = records.findings.toSorted(bySeverityThenPlace);
  const anchored = ordered.filter((finding) => isAnchored(finding));
  const loose = ordered.filter((finding) => !isAnchored(finding));

  const inline = maxInline <= 0 ? [] : anchored.slice(0, maxInline);
  const spilled = anchored.slice(inline.length);

  const comments: InlineComment[] = inline.map((finding) => ({
    path: finding.path,
    line: finding.line,
    // `start_line === line` is a single line spelled long; some providers reject it.
    ...(finding.start_line !== null &&
      finding.start_line !== finding.line && { start_line: finding.start_line }),
    body: commentBody(finding),
  }));

  return {
    body: reviewBody(records, loose, spilled),
    comments,
    overflow: spilled.length,
    event: reviewEventFor(ordered, options.requestChangesOn ?? []),
  };
}

/** The review's own comment: headline, what is not inline, tallies. */
function reviewBody(
  records: ReviewRecords,
  loose: readonly Finding[],
  spilled: readonly Finding[],
): string {
  const { findings, summary } = records;
  const tally = tallies(summary, records.unreadable);
  return [
    "### Automated review",
    "",
    headline(findings),
    ...(loose.length > 0
      ? ["", details(`${loose.length} finding(s) that could not be anchored to a line`, loose)]
      : []),
    ...(spilled.length > 0
      ? ["", details(`${spilled.length} further finding(s) not posted inline`, spilled)]
      : []),
    ...(tally === "" ? [] : ["", tally]),
  ].join("\n");
}

function headline(findings: readonly Finding[]): string {
  if (findings.length === 0) return "No issues found in the reviewed files.";
  const files = new Set(findings.map((finding) => finding.path)).size;
  return `**${findings.length} finding(s)** across **${files} file(s)**.`;
}

/** A collapsed block naming findings that are not inline. */
function details(summary: string, findings: readonly Finding[]): string {
  const shown = findings.slice(0, MAX_LISTED);
  const overflow =
    findings.length > MAX_LISTED ? [`- … and ${findings.length - MAX_LISTED} more.`] : [];
  return [
    "<details>",
    `<summary>${summary}</summary>`,
    "",
    ...shown.map((finding) => {
      const where = finding.line === null ? finding.path : `${finding.path}:${finding.line}`;
      return `- \`${where}\` **[${severityLabel(finding.severity)}]** ${oneLine(finding.body)}`;
    }),
    ...overflow,
    "",
    "</details>",
  ].join("\n");
}

/** A body on one line, cut at 240 characters. */
function oneLine(body: string): string {
  const text = body.replaceAll("\n", " ").replaceAll(/\s+/gu, " ").trim();
  return text.length > 240 ? `${text.slice(0, 239).trimEnd()}…` : text;
}

/** The run's counters, so the finding count reads in context. */
function tallies(summary: SummaryRecord | null, unreadable: number): string {
  const notes = [
    ...(summary === null
      ? []
      : [
          `${summary.files_reviewed} of ${summary.files_changed} changed file(s) reviewed against \`${summary.base}\``,
          ...(summary.refuted > 0 ? [`${summary.refuted} refuted by verification`] : []),
          ...(summary.capped > 0 ? [`${summary.capped} withheld by the per-file cap`] : []),
        ]),
    ...(unreadable > 0 ? [`${unreadable} unreadable record(s)`] : []),
  ];
  return notes.length === 0 ? "" : `<sub>${notes.join("; ")}.</sub>`;
}
