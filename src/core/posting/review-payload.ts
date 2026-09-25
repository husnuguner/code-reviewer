/**
 * Turns a run's records into one change-request review. Pure: records in, a payload out.
 * @packageDocumentation
 */

import { type ReviewEvent } from "../ports/review-poster";
import {
  type BypassRegionRecord,
  type FindingRecord,
  type SummaryRecord,
} from "../ports/review-reporter";
import { regionLocation, sortedRegions } from "../review/bypass";
import { incrementalNote } from "../review/render";
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
  /** Anchored findings not posted inline because an earlier automated review already sits on their lines. */
  readonly alreadyPosted: number;
  /** `request-changes` when any finding's severity is gated, else `comment`. */
  readonly event: ReviewEvent;
}

/**
 * An inline comment already on the change request, as the host places it **now**: the host moves a
 * comment's line as the branch changes, and marks it outdated (`line: null`) when its lines are gone.
 */
export interface PostedComment {
  readonly path: string;
  readonly line: number | null;
  readonly start_line: number | null;
}

/**
 * Appended to every inline comment body, so a later run can tell its own comments from a human's without
 * trusting a login. Invisible when rendered.
 */
export const COMMENT_MARKER = "<!-- code-reviewer -->";

/**
 * Two multi-line comments are the same when their line ranges overlap by more than this share of their
 * union (intersection over union). Strict: a pair exactly at the threshold is not a duplicate.
 * Single-line comments match on the line alone; a single-line and a multi-line comment never match, so a
 * finer note on one line is not swallowed by an earlier block comment.
 */
export const OVERLAP_THRESHOLD = 0.6;

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
    incremental: record["incremental"] === true,
    files_changed: count(record["files_changed"]),
    files_reviewed: count(record["files_reviewed"]),
    failed: count(record["failed"]),
    findings: count(record["findings"]),
    files_with_findings: count(record["files_with_findings"]),
    anchors: {},
    unanchored: count(record["unanchored"]),
    refuted: count(record["refuted"]),
    capped: count(record["capped"]),
    mislabelled: count(record["mislabelled"]),
    bypassed: count(record["bypassed"]),
    skipped: {},
    policy_changed: stringList(record["policy_changed"]),
    bypass_regions: regionList(record["bypass_regions"]),
  };
}

/** The well-formed regions of a JSON list: a path, two positive lines in order, a reason; anything else is dropped. */
function regionList(value: JsonValue | undefined): BypassRegionRecord[] {
  if (!isJsonArray(value)) return [];
  return value.flatMap((item): BypassRegionRecord[] => {
    if (!isJsonObject(item)) return [];
    const path = text_(item["path"]);
    const start = lineNumber(item["start_line"]);
    const end = lineNumber(item["end_line"]);
    return path === "" || start === null || end === null || end < start
      ? []
      : [{ path, start_line: start, end_line: end, reason: text_(item["reason"]) }];
  });
}

/** The strings of a JSON list; anything else reads as none. */
function stringList(value: JsonValue | undefined): string[] {
  return isJsonArray(value)
    ? value.flatMap((item) => (typeof item === "string" ? [item] : []))
    : [];
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
  return `${head}${example}${skills}\n\n${COMMENT_MARKER}`;
}

/** A comment's span on the new side: its first and last line, and whether it covers more than one. */
interface Span {
  readonly start: number;
  readonly end: number;
  readonly isMultiLine: boolean;
}

/** The span of an anchored finding or a posted comment; `null` for one the host has marked outdated. */
function spanOf(comment: { line: number | null; start_line?: number | null }): Span | null {
  if (comment.line === null) return null;
  const start = comment.start_line ?? comment.line;
  const [low, high] = start <= comment.line ? [start, comment.line] : [comment.line, start];
  return { start: low, end: high, isMultiLine: low !== high };
}

/** Whether two spans are one comment's place: the same line, or ranges alike past {@link OVERLAP_THRESHOLD}. */
function isSameSpan(a: Span, b: Span): boolean {
  if (a.isMultiLine !== b.isMultiLine) return false;
  if (!a.isMultiLine) return a.start === b.start;
  const overlap = Math.min(a.end, b.end) - Math.max(a.start, b.start) + 1;
  if (overlap <= 0) return false;
  const union = a.end - a.start + 1 + (b.end - b.start + 1) - overlap;
  return overlap / union > OVERLAP_THRESHOLD;
}

/**
 * Whether an earlier automated comment already sits where this finding would go.
 *
 * @remarks The posted comment's place is the host's current one, so a line that moved with the branch
 * still matches, and an outdated comment (no current line) matches nothing: its code is gone.
 */
export function isAlreadyPosted(
  finding: AnchoredFinding,
  posted: readonly PostedComment[],
): boolean {
  const span = spanOf(finding);
  if (span === null) return false;
  return posted.some((comment) => {
    if (comment.path !== finding.path) return false;
    const other = spanOf(comment);
    return other !== null && isSameSpan(span, other);
  });
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
  /**
   * The automated inline comments already on the change request. A finding one of them already covers is
   * not posted inline again; it is counted in the body instead. Default none.
   */
  readonly posted?: readonly PostedComment[];
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
  const posted = options.posted ?? [];
  const ordered = records.findings.toSorted(bySeverityThenPlace);
  const anchored = ordered.filter((finding) => isAnchored(finding));
  const loose = ordered.filter((finding) => !isAnchored(finding));

  // Findings an earlier run already placed leave the cap's slots to the new ones.
  const fresh = anchored.filter((finding) => !isAlreadyPosted(finding, posted));
  const alreadyPosted = anchored.length - fresh.length;
  const inline = maxInline <= 0 ? [] : fresh.slice(0, maxInline);
  const spilled = fresh.slice(inline.length);

  const comments: InlineComment[] = inline.map((finding) => ({
    path: finding.path,
    line: finding.line,
    // `start_line === line` is a single line spelled long; some providers reject it.
    ...(finding.start_line !== null &&
      finding.start_line !== finding.line && { start_line: finding.start_line }),
    body: commentBody(finding),
  }));

  return {
    body: reviewBody(records, loose, spilled, alreadyPosted),
    comments,
    overflow: spilled.length,
    alreadyPosted,
    event: reviewEventFor(ordered, options.requestChangesOn ?? []),
  };
}

/** The review's own comment: headline, a policy warning when the change edits one, what is not inline, tallies. */
function reviewBody(
  records: ReviewRecords,
  loose: readonly Finding[],
  spilled: readonly Finding[],
  alreadyPosted: number,
): string {
  const { findings, summary } = records;
  const tally = tallies(summary, records.unreadable, alreadyPosted);
  const incomplete = incompleteNote(summary);
  const policy = policyNote(summary?.policy_changed ?? []);
  const bypass = bypassNote(summary?.bypass_regions ?? []);
  const scope =
    summary?.incremental === true ? `> **${incrementalNote(`\`${summary.base}\``)}**` : "";
  return [
    "### Automated review",
    "",
    ...(incomplete === "" ? [] : [incomplete, ""]),
    headline(findings, incomplete !== ""),
    ...(scope === "" ? [] : ["", scope]),
    ...(policy === "" ? [] : ["", policy]),
    ...(bypass === "" ? [] : ["", bypass]),
    ...(loose.length > 0
      ? ["", details(`${loose.length} finding(s) that could not be anchored to a line`, loose)]
      : []),
    ...(spilled.length > 0
      ? ["", details(`${spilled.length} further finding(s) not posted inline`, spilled)]
      : []),
    ...(tally === "" ? [] : ["", tally]),
  ].join("\n");
}

/** The warning a change that edits the review policy earns: those files are named, and the reader is asked to read them. */
function policyNote(changed: readonly string[]): string {
  if (changed.length === 0) return "";
  const files = changed.map((path) => `\`${path}\``).join(", ");
  return `> **This pull request edits the review policy** (${files}). A policy can weaken the review that reads it, so read those files yourself.`;
}

/** The note a change carrying bypass markers earns: every region named with its reason, so a reader can judge each. */
function bypassNote(regions: readonly BypassRegionRecord[]): string {
  if (regions.length === 0) return "";
  const listed = sortedRegions(regions)
    .map((region) => `\`${regionLocation(region)}\` (${region.reason})`)
    .join(", ");
  return `> **Review was bypassed by markers in the code** in ${regions.length} region(s): ${listed}. A bypass is the author's call, not the reviewer's, so read those yourself.`;
}

/**
 * Whether the stream describes a run that finished and reviewed every file it selected: a summary record
 * is present and counts no failed file. Only such a run may lift an earlier verdict.
 */
export function isCompleteRun(records: Pick<ReviewRecords, "summary">): boolean {
  return records.summary !== null && records.summary.failed === 0;
}

/**
 * What a reader must know first when the run is not a verdict: it did not finish (no summary record), or
 * some files could not be reviewed. `""` for a complete run.
 */
function incompleteNote(summary: SummaryRecord | null): string {
  if (summary === null) {
    return "> **Review incomplete:** the findings file ends without a summary, so the review run did not finish. Nothing here is a verdict; the review job's log says why.";
  }
  return summary.failed > 0
    ? `> **Review incomplete:** ${summary.failed} file(s) could not be reviewed; the review job's log says why. Nothing here is a verdict on them.`
    : "";
}

function headline(findings: readonly Finding[], isIncomplete: boolean): string {
  if (findings.length === 0) {
    return isIncomplete
      ? "No issues found in the files that were reviewed."
      : "No issues found in the reviewed files.";
  }
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
function tallies(summary: SummaryRecord | null, unreadable: number, alreadyPosted: number): string {
  const notes = [
    ...(summary === null
      ? []
      : [
          `${summary.files_reviewed} of ${summary.files_changed} changed file(s) reviewed against \`${summary.base}\``,
          ...(summary.failed > 0 ? [`${summary.failed} could not be reviewed`] : []),
          ...(summary.refuted > 0 ? [`${summary.refuted} refuted by verification`] : []),
          ...(summary.capped > 0 ? [`${summary.capped} withheld by the per-file cap`] : []),
          ...(summary.bypassed > 0
            ? [`${summary.bypassed} added line(s) in bypassed regions not reviewed`]
            : []),
        ]),
    ...(alreadyPosted > 0
      ? [`${alreadyPosted} already posted inline by an earlier review and not repeated`]
      : []),
    ...(unreadable > 0 ? [`${unreadable} unreadable record(s)`] : []),
  ];
  return notes.length === 0 ? "" : `<sub>${notes.join("; ")}.</sub>`;
}
