/**
 * Turning a run's records into one change-request review.
 *
 * This is the CI bot's half of the split: the reviewer writes NDJSON and
 * never posts; this decides what that stream should *say* on a pull request.
 * It is deliberately pure — records in, a payload out — so the shape of a
 * review is testable without a token, a network or a language model, and so
 * the process that builds it can be the one that has no model at all.
 *
 * Three rules make the payload trustworthy:
 *
 * 1. **An unanchored finding is listed, never dropped.** It has no line to
 *    hang on, and those are often the findings hardest to place and most
 *    worth reading.
 * 2. **What does not fit is counted.** A provider will refuse an oversized
 *    review, so inline comments are capped — and the body says how many were
 *    left out rather than letting them vanish.
 * 3. **The body repeats the run's own tallies.** `refuted` and `capped` are
 *    what make "only three findings" mean something.
 */

import { type FindingRecord, type SummaryRecord } from "../ports/review-reporter";
import { severityLabel, severityRankOf } from "../review/severity";
import { type JsonObject, type JsonValue, isJsonArray, isJsonObject } from "../util/json";
import { compareCodePoints } from "../util/py";

/** One finding as the record stream carries it (no `type` discriminator). */
export type Finding = Omit<FindingRecord, "type">;

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
  /** Anchored findings the inline cap left out; they are named in the body. */
  readonly overflow: number;
}

/**
 * How many inline comments one review may carry.
 *
 * Not a style choice: a review with too many inline comments is refused by
 * the API as a whole, which would lose every finding rather than the last
 * few. Fifty is also well past what anyone reads in one sitting.
 */
export const MAX_INLINE = 50;

/** How many listed findings a collapsed block shows before summarising. */
const MAX_LISTED = 50;

/**
 * Read a record stream, tolerating a line this build does not understand.
 *
 * A bad line costs that line and nothing else: the alternative — throwing —
 * would turn one malformed record into a review nobody gets, which is the
 * wrong trade for a reporting path.
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

/** One decoded line, or `null` when it is not a record this build reads. */
type DecodedLine =
  | { readonly kind: "finding"; readonly finding: Finding }
  | { readonly kind: "summary"; readonly summary: SummaryRecord };

/**
 * Decode and *validate* one line.
 *
 * Every field is read through a narrowing helper rather than asserted: this
 * input arrives from a file on disk, and a record whose `line` is a string
 * would otherwise reach a hosting API as one and fail the whole review.
 */
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

/** A line number, or `null` for an unanchored finding or a bad value. */
function lineNumber(value: JsonValue | undefined): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

/** A finding needs a path and a body; without either there is nothing to say. */
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
      ? skills.filter((skill): skill is string => typeof skill === "string")
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
    findings: count(record["findings"]),
    files_with_findings: count(record["files_with_findings"]),
    anchors: {},
    unanchored: count(record["unanchored"]),
    refuted: count(record["refuted"]),
    capped: count(record["capped"]),
    skipped: {},
  };
}

/** One finding as an inline comment body: label, text, the fix example. */
export function commentBody(finding: Finding): string {
  const head = `**[${severityLabel(finding.severity)}]** ${finding.body}`;
  // A fenced block, not a ```suggestion: the example is illustrative code,
  // and offering it as a one-click commit would apply text nobody checked
  // against the surrounding lines.
  const example = finding.example === "" ? "" : `\n\n\`\`\`\n${finding.example}\n\`\`\``;
  const skills =
    finding.skills.length === 0 ? "" : `\n\n<sub>skills: ${finding.skills.join(", ")}</sub>`;
  return `${head}${example}${skills}`;
}

/** Most severe first, then by path and line, so two runs read the same way. */
function bySeverityThenPlace(a: Finding, b: Finding): number {
  return (
    severityRankOf(a.severity) - severityRankOf(b.severity) ||
    compareCodePoints(a.path, b.path) ||
    (a.line ?? 0) - (b.line ?? 0)
  );
}

export interface BuildReviewOptions {
  /** Cap on inline comments; the rest are named in the body. Default `MAX_INLINE`. */
  readonly maxInline?: number;
}

/**
 * Build the review a record stream describes.
 *
 * Anchored findings become inline comments, most severe first, so that the
 * ones the cap keeps are the ones worth keeping. Everything else — the
 * unanchored, the overflow, the tallies — goes in the body, because a review
 * that silently carries less than the run found is worse than a long one.
 */
export function buildReview(
  records: ReviewRecords,
  options: BuildReviewOptions = {},
): ReviewPayload {
  const maxInline = options.maxInline ?? MAX_INLINE;
  const ordered = records.findings.toSorted(bySeverityThenPlace);
  const anchored = ordered.filter((finding) => finding.line !== null);
  const loose = ordered.filter((finding) => finding.line === null);

  const inline = maxInline <= 0 ? [] : anchored.slice(0, maxInline);
  const spilled = anchored.slice(inline.length);

  const comments: InlineComment[] = inline.map((finding) => ({
    path: finding.path,
    line: finding.line as number,
    // A span only when it really is one: `start_line === line` is a
    // single-line anchor spelled the long way, and some providers reject it.
    ...(finding.start_line !== null &&
      finding.start_line !== finding.line && { start_line: finding.start_line }),
    body: commentBody(finding),
  }));

  return {
    body: reviewBody(records, loose, spilled),
    comments,
    overflow: spilled.length,
  };
}

/** The review's own comment: a headline, what is not inline, and the tallies. */
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

/** A body squeezed onto one line, so a list stays skimmable. */
function oneLine(body: string): string {
  const text = body.replaceAll("\n", " ").replaceAll(/\s+/gu, " ").trim();
  return text.length > 240 ? `${text.slice(0, 239).trimEnd()}…` : text;
}

/** The run's own counters, so "three findings" can be read in context. */
function tallies(summary: SummaryRecord | null, unreadable: number): string {
  const notes = [
    ...(summary === null
      ? []
      : [
          `${summary.files_reviewed} of ${summary.files_changed} changed file(s) reviewed against \`${summary.base}\``,
          ...(summary.refuted > 0 ? [`${summary.refuted} refuted by verification`] : []),
          ...(summary.capped > 0 ? [`${summary.capped} withheld by the per-file cap`] : []),
        ]),
    // A stream this build could not read fully is worth saying out loud: the
    // alternative is a review that quietly describes less than the run found.
    ...(unreadable > 0 ? [`${unreadable} unreadable record(s)`] : []),
  ];
  return notes.length === 0 ? "" : `<sub>${notes.join("; ")}.</sub>`;
}
