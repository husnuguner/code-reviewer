/**
 * Taking a block out of review from inside the code. A comment reading `reviewer: by-pass - <reason>`
 * marks the block that follows it -- a function, an `if`, a class, a Python `def` -- and no finding
 * inside that block is reported. The marker sits in the diff for every human reviewer to see, the reason
 * is required, and every run names the regions it honoured, so a bypass is a visible decision, never a
 * silent one.
 * @packageDocumentation
 */

import { type Finding } from "../domain/finding";
import { type BypassRegionRecord } from "../ports/review-reporter";
import { compareCodePoints } from "../util/text";

import { braceDepthChange, withoutStringLiterals } from "./braces";

/** One bypassed stretch of a file, in new-side line numbers, both ends inclusive. */
export interface BypassRegion {
  readonly start: number;
  readonly end: number;
  /** What the marker gave as the reason; never empty. */
  readonly reason: string;
}

/** What a scan of one file found. */
export interface BypassScan {
  /** The honoured regions, by start line, overlapping ones merged. */
  readonly regions: readonly BypassRegion[];
  /** Lines carrying a marker without a reason; those are not honoured. */
  readonly unreasoned: readonly number[];
}

/**
 * The marker: `reviewer: by-pass - <reason>` (or `bypass`), in any comment syntax, any case. What follows
 * the separator, to the end of the line, is the reason.
 */
const MARKER = /\breviewer:\s*by-?pass\b[\s\-\u{2013}\u{2014}:]*(?<reason>.*)$/iu;

/** A comment closer at the end of a reason, when the marker sits in a block or HTML comment. */
const COMMENT_CLOSER = /\s*(?:\*\/|-->)\s*$/u;

/** A comment opener just before the marker; what precedes it is the line's code. */
const COMMENT_OPENER = /(?:\/\/|\/\*+|#+|--|<!--|\*)\s*$/u;

/** A line that is only a comment, which the block a marker names cannot begin on. */
const COMMENT_ONLY = /^\s*(?:\/\/|\/\*|\*|#|--|<!--|-->)/u;

/** `else`, `catch`, `finally` continue a brace block; `elif`, `except` continue a Python one. */
const CHAIN = /^\s*(?:else|elif|catch|finally|except)\b/u;

/**
 * How far past a head the block's opening brace is looked for: a wrapped signature or a decorated
 * declaration puts it a few lines down, never forty.
 */
const MAX_HEAD_LINES = 40;

/**
 * Trailing comments, so a brace or colon inside one is not read as structure.
 *
 * @remarks `#` opens a comment only before whitespace, `!` or the end of the line: `#count = {` is a
 * private field and `#include` a directive, and neither may hide a brace from the count. A block
 * comment spanning several lines is not recognised; a brace inside one counts.
 */
function withoutComments(code: string): string {
  return code
    .replaceAll(/\/\*.*?\*\//gu, "")
    .replaceAll(/<!--.*?-->/gu, "")
    .replace(/\/\/.*$/u, "")
    .replace(/(?:^|\s)#(?:\s|!|$).*$/u, "")
    .replace(/(?:^|\s)--.*$/u, "");
}

/** The structural part of a line: no string literals, no comments. */
function codeOf(line: string): string {
  return withoutComments(withoutStringLiterals(line));
}

/** How much deeper in parentheses and brackets a line ends than it began. */
function parenDepthChange(code: string): number {
  let change = 0;
  for (const found of code) {
    if (found === "(" || found === "[") change += 1;
    else if (found === ")" || found === "]") change -= 1;
  }
  return change;
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

/** Whether the line is blank or a comment and nothing else. */
function isSkippable(line: string): boolean {
  return line.trim() === "" || COMMENT_ONLY.test(line);
}

/** The first line at or after `from` that carries code, or `null` past the end. */
function nextCodeLine(lines: readonly string[], from: number): number | null {
  for (let index = from; index < lines.length; index++) {
    if (!isSkippable(lines[index] ?? "")) return index;
  }
  return null;
}

/**
 * The last line of the brace block opening on `from`.
 *
 * @param from - A line whose brace depth change is positive.
 * @returns The line the depth returns to zero on; the last line when the block never closes.
 */
function braceBlockEnd(lines: readonly string[], from: number): number {
  let depth = braceDepthChange(codeOf(lines[from] ?? ""));
  if (depth <= 0) return from;
  for (let index = from + 1; index < lines.length; index++) {
    depth += braceDepthChange(codeOf(lines[index] ?? ""));
    if (depth <= 0) return index;
  }
  return lines.length - 1;
}

/**
 * The last line of the indentation block whose head is `head` (a line ending in `:`).
 *
 * @returns The last deeper-indented line; `head` itself when nothing follows at a deeper indent.
 */
function indentBlockEnd(lines: readonly string[], head: number): number {
  const indent = indentOf(lines[head] ?? "");
  let end = head;
  for (let index = head + 1; index < lines.length; index++) {
    const line = lines[index] ?? "";
    if (line.trim() === "") continue;
    if (indentOf(line) <= indent) break;
    end = index;
  }
  return end;
}

/**
 * The last line of the statement or block that starts on `head`.
 *
 * @remarks A block is opened by the first line, within {@link MAX_HEAD_LINES}, that opens more braces
 * than it closes -- the head itself, a wrapped signature's last line, or an Allman-style `{` alone. A head
 * ending in `:` opens an indentation block. Anything else is one statement, which ends where its
 * parentheses balance. After a block, `else`/`catch`/`finally` (or `elif`/`except`) carry it on.
 */
function statementEnd(lines: readonly string[], head: number): number {
  const headCode = codeOf(lines[head] ?? "").trim();
  if (headCode.endsWith(":") && braceDepthChange(headCode) <= 0) {
    return chained(lines, head, indentBlockEnd(lines, head), true);
  }
  let parens = 0;
  const last = Math.min(lines.length - 1, head + MAX_HEAD_LINES);
  for (let index = head; index <= last; index++) {
    const code = codeOf(lines[index] ?? "");
    if (braceDepthChange(code) > 0) return chained(lines, head, braceBlockEnd(lines, index), false);
    parens += parenDepthChange(code);
    if (parens > 0) continue;
    if (code.trimEnd().endsWith(";")) return chainedOnNextLine(lines, head, index, false);
    // A statement that balanced without a terminator: an Allman `{` on the next code line opens its block.
    const next = nextCodeLine(lines, index + 1);
    return next !== null &&
      codeOf(lines[next] ?? "")
        .trimStart()
        .startsWith("{")
      ? chained(lines, head, braceBlockEnd(lines, next), false)
      : index;
  }
  return head;
}

/**
 * Extends a block that ends on `end` through any `else`/`catch`/`finally` chain that follows.
 *
 * @param isIndented - Whether the block was an indentation block, whose continuation must sit at the
 * head's own indent.
 * @remarks `} else {` on one line never reaches here: the depth count carries straight through it. What
 * does is `} else` with its brace on the next line, and a keyword on a line of its own. The tail is not
 * read when the block began on `end` itself, so a malformed line cannot send the scan round in a circle.
 */
function chained(lines: readonly string[], head: number, end: number, isIndented: boolean): number {
  if (!isIndented && head !== end) {
    const closing = codeOf(lines[end] ?? "");
    const tail = closing.slice(closing.lastIndexOf("}") + 1);
    if (CHAIN.test(tail)) return Math.max(end, statementEnd(lines, end));
  }
  return chainedOnNextLine(lines, head, end, isIndented);
}

/** The chain continuation on the next line of code, if there is one: `else`, `catch`, `finally`, `elif`, `except`. */
function chainedOnNextLine(
  lines: readonly string[],
  head: number,
  end: number,
  isIndented: boolean,
): number {
  const next = nextCodeLine(lines, end + 1);
  if (next === null) return end;
  const line = lines[next] ?? "";
  if (!CHAIN.test(codeOf(line))) return end;
  return isIndented && indentOf(line) !== indentOf(lines[head] ?? "")
    ? end
    : statementEnd(lines, next);
}

/**
 * The line the block a marker names begins on: the first code line at or after `from`, past any
 * decorators (`@Component({...})`, `@app.route("/")`), which annotate the declaration below them.
 */
function headFrom(lines: readonly string[], from: number): number | null {
  let head = nextCodeLine(lines, from);
  while (
    head !== null &&
    codeOf(lines[head] ?? "")
      .trimStart()
      .startsWith("@")
  ) {
    head = nextCodeLine(lines, statementEnd(lines, head) + 1);
  }
  return head;
}

/** The reason a marker gives, or `""`. */
function reasonOf(match: RegExpMatchArray): string {
  return (match.groups?.["reason"] ?? "").replace(COMMENT_CLOSER, "").trim();
}

/** Whether the marker shares its line with code, in which case that line is the head. */
function hasCodeBefore(line: string, markerAt: number): boolean {
  const before = withoutStringLiterals(line.slice(0, markerAt)).replace(COMMENT_OPENER, "");
  return before.trim() !== "";
}

/** Sorted by start; regions that overlap become one, their distinct reasons joined. */
function merged(regions: readonly BypassRegion[]): BypassRegion[] {
  const ordered = regions.toSorted((a, b) => a.start - b.start || a.end - b.end);
  const out: BypassRegion[] = [];
  for (const region of ordered) {
    const previous = out.at(-1);
    if (previous === undefined || region.start > previous.end) {
      out.push(region);
      continue;
    }
    const reasons = previous.reason.split("; ");
    const reason = reasons.includes(region.reason)
      ? previous.reason
      : `${previous.reason}; ${region.reason}`;
    out[out.length - 1] = {
      start: previous.start,
      end: Math.max(previous.end, region.end),
      reason,
    };
  }
  return out;
}

/**
 * Finds every bypass marker in a file and the region each one names.
 *
 * @param lines - The file's new side, whole; line `n` is `lines[n - 1]`.
 * @returns The honoured regions and the lines of markers that gave no reason.
 * @remarks A marker on a line with code names that line's statement; a marker on its own line names the
 * next line of code. The region runs from the marker to the end of that statement or block.
 */
export function scanBypass(lines: readonly string[]): BypassScan {
  const regions: BypassRegion[] = [];
  const unreasoned: number[] = [];
  for (const [index, line] of lines.entries()) {
    // A marker inside a string literal is data, not an instruction; one in a comment survives the strip.
    if (!MARKER.test(withoutStringLiterals(line))) continue;
    const match = MARKER.exec(line);
    if (match === null) continue;
    const reason = reasonOf(match);
    if (reason === "") {
      unreasoned.push(index + 1);
      continue;
    }
    const head = hasCodeBefore(line, match.index) ? index : headFrom(lines, index + 1);
    const end = head === null ? index : statementEnd(lines, head);
    regions.push({ start: index + 1, end: Math.max(index, end) + 1, reason });
  }
  return { regions: merged(regions), unreasoned };
}

/** Whether new-side line `line` lies in one of `regions`. */
export function isBypassed(line: number, regions: readonly BypassRegion[]): boolean {
  return regions.some((region) => region.start <= line && line <= region.end);
}

/** Whether every line of `lines` lies in a region: nothing left for a model to comment on. */
export function isWhollyBypassed(
  lines: Iterable<number>,
  regions: readonly BypassRegion[],
): boolean {
  let hasLines = false;
  for (const line of lines) {
    hasLines = true;
    if (!isBypassed(line, regions)) return false;
  }
  return hasLines;
}

/** Result of removing a file's bypassed findings. */
export interface BypassedFindings {
  readonly kept: readonly Finding[];
  readonly bypassed: readonly Finding[];
}

/**
 * Splits findings by whether their anchor falls in a bypassed region.
 *
 * @remarks A multi-line anchor is bypassed when any of its lines is. A finding with no line cannot be
 * placed, so it is kept: the marker names code, not comments about the file at large.
 */
export function withoutBypassed(
  findings: readonly Finding[],
  regions: readonly BypassRegion[],
): BypassedFindings {
  if (regions.length === 0) return { kept: findings, bypassed: [] };
  const kept: Finding[] = [];
  const bypassed: Finding[] = [];
  for (const finding of findings) {
    if (finding.line === null) {
      kept.push(finding);
      continue;
    }
    const first = finding.start_line ?? finding.line;
    let isInside = false;
    for (let line = Math.min(first, finding.line); !isInside && line <= finding.line; line++) {
      isInside = isBypassed(line, regions);
    }
    (isInside ? bypassed : kept).push(finding);
  }
  return { kept, bypassed };
}

/** A file's regions as the summary record carries them. */
export function regionRecords(
  path: string,
  regions: readonly BypassRegion[],
): BypassRegionRecord[] {
  return regions.map((region) => ({
    path,
    start_line: region.start,
    end_line: region.end,
    reason: region.reason,
  }));
}

/** Where a region is: `src/a.ts:41-80`, or `src/a.ts:41` for one line. */
export function regionLocation(record: BypassRegionRecord): string {
  return record.start_line === record.end_line
    ? `${record.path}:${record.start_line}`
    : `${record.path}:${record.start_line}-${record.end_line}`;
}

/** One region as a report spells it: `src/a.ts:41-80 (reason)`. */
export function describeRegion(record: BypassRegionRecord): string {
  return `${regionLocation(record)} (${record.reason})`;
}

/** Regions as the summary lists them: by path, then by start line. */
export function sortedRegions(records: readonly BypassRegionRecord[]): BypassRegionRecord[] {
  return records.toSorted(
    (a, b) => compareCodePoints(a.path, b.path) || a.start_line - b.start_line,
  );
}

/** The one-line note every report carries when regions were bypassed; `""` when none were. */
export function bypassWarning(records: readonly BypassRegionRecord[]): string {
  if (records.length === 0) return "";
  const listed = sortedRegions(records).map((record) => describeRegion(record));
  return `Review was bypassed by markers in the code in ${records.length} region(s): ${listed.join(", ")}; read those yourself.`;
}
