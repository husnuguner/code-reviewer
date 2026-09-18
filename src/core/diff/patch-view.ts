/**
 * Helpers over one file's unified-diff `patch` string.
 *
 * Inline review comments may only anchor to lines that are part of the diff;
 * in practice the reliably commentable lines are the ADDED (`+`) lines,
 * addressed by their NEW-file (target) line number. This module derives the
 * line-numbered rendering the model is shown, the commentable set, and the new
 * side as a matchable index.
 *
 * Those three are **one** answer, not three: they are computed together by
 * `patchView` and travel together, because a diff that is too large to show in
 * full is cut -- and a cut that only reached the rendering would leave the
 * model told it may comment on lines it was never shown, with a quote matcher
 * searching text nobody sent. The cut is therefore taken here, over whole
 * hunks, and every derived answer is taken from what is actually shown.
 */

import { countCodePoints } from "../util/text";

import { type DiffLine, hunkHeader, parseUnifiedDiff } from "./unified-diff";

/** One entry of the new side: `[new-file line number, text]`. */
export type NewSideEntry = readonly [line: number, text: string];

/**
 * One rendered row of a hunk: the text the model reads, and what that row
 * contributes to the answers derived from it.
 */
interface Row {
  /** The row as the annotated diff prints it (`[L12] +foo()`). */
  readonly text: string;
  /** Its new-file line number, or `null` for a row the new side has not got. */
  readonly newLine: number | null;
  readonly isAdded: boolean;
  /** The line verbatim, no marker and no `[L<n>]`: the anchor haystack's side. */
  readonly value: string;
}

/** One hunk as it would be shown, and what showing it costs. */
interface AnnotatedHunk {
  readonly header: string;
  readonly rows: readonly Row[];
  /** Code points the header and the rows occupy, each one's newline included. */
  readonly chars: number;
  /** Whether a finding could be anchored inside it at all. */
  readonly isCommentable: boolean;
}

/**
 * What the model is shown for one file, and the two answers derived from it.
 *
 * `addedLines` and `newSide` describe `annotated` and nothing else. That is
 * the invariant this type exists to carry: an allowed line is a line the
 * model has in front of it, and the quote matcher's haystack is the text the
 * quote was taken from.
 */
export interface PatchView {
  /** The line-numbered diff, whole hunks only, within the caller's budget. */
  readonly annotated: string;
  /** New-file line numbers a finding may anchor to, as shown. */
  readonly addedLines: ReadonlySet<number>;
  /** The shown text's new side, in file order. */
  readonly newSide: readonly NewSideEntry[];
  /** Length of the whole annotated diff, before any clipping. */
  readonly chars: number;
  /** Whether `annotated` shows less than the whole diff. */
  readonly clipped: boolean;
}

/** One diff line as a row of the annotated rendering. */
function rowOf(line: DiffLine): Row {
  const rendered = `${line.type}${line.value}`;
  const isAdded = line.type === "+";
  // Context and added lines have a new-file number; a removed line has none
  // to anchor to, and the no-newline marker is not a line at all.
  const isNewSide = isAdded || line.type === " ";
  return {
    text: isAdded ? `[L${line.targetLineNo ?? 0}] ${rendered}` : rendered,
    newLine: isNewSide ? line.targetLineNo : null,
    isAdded,
    value: line.value,
  };
}

/** Code points one piece of the rendering costs, its newline included. */
function costOf(text: string): number {
  return countCodePoints(text) + 1;
}

/** Every hunk of the patch, rendered, in file order. */
function annotatedHunks(patch: string): AnnotatedHunk[] {
  const out: AnnotatedHunk[] = [];
  for (const file of parseUnifiedDiff(patch)) {
    for (const hunk of file.hunks) {
      const header = hunkHeader(hunk);
      const rows = hunk.lines.map((line) => rowOf(line));
      out.push({
        header,
        rows,
        chars: rows.reduce((total, row) => total + costOf(row.text), costOf(header)),
        isCommentable: rows.some((row) => row.isAdded && row.newLine !== null),
      });
    }
  }
  return out;
}

/** What the hunks join to: their pieces, one per line, no trailing newline. */
function lengthOf(hunks: readonly AnnotatedHunk[]): number {
  const total = hunks.reduce((sum, hunk) => sum + hunk.chars, 0);
  return total === 0 ? 0 : total - 1;
}

/**
 * One hunk cut at a line boundary: its header and the rows that fit.
 *
 * The budget is exceeded in exactly one case, deliberately: when no added row
 * fits, the rows up to and including the first one are kept anyway. A shown
 * diff with nothing commentable in it is worse than a slightly long one --
 * the model would be asked to review text it may not comment on.
 */
function clipRows(hunk: AnnotatedHunk, maxChars: number): AnnotatedHunk {
  const fitting: Row[] = [];
  let used = costOf(hunk.header);
  for (const row of hunk.rows) {
    if (used + costOf(row.text) - 1 > maxChars) break;
    fitting.push(row);
    used += costOf(row.text);
  }
  const firstAdded = hunk.rows.findIndex((row) => row.isAdded && row.newLine !== null);
  const rows =
    firstAdded === -1 || fitting.some((row) => row.isAdded)
      ? fitting
      : hunk.rows.slice(0, firstAdded + 1);
  return {
    header: hunk.header,
    rows,
    chars: rows.reduce((total, row) => total + costOf(row.text), costOf(hunk.header)),
    isCommentable: rows.some((row) => row.isAdded && row.newLine !== null),
  };
}

/**
 * The hunks that fit in `maxChars`, from the first one a finding could be
 * anchored in.
 *
 * Whole hunks, in file order, which is what keeps the shown text a valid diff
 * and its `[L<n>]` markers meaningful. Leading hunks with no added line are
 * passed over rather than spent on: they carry nothing the model may comment
 * on, so with a budget too small for the file they are the first thing worth
 * giving up. A single hunk larger than the whole budget -- or a budget of
 * zero, which `max-file-chars` accepts -- is cut at a line boundary, never
 * mid-line and never to nothing: a patch that adds lines always shows one.
 */
function clipHunks(hunks: readonly AnnotatedHunk[], maxChars: number): AnnotatedHunk[] {
  const commentable = hunks.findIndex((hunk) => hunk.isCommentable);
  const from = commentable === -1 ? 0 : commentable;
  const kept: AnnotatedHunk[] = [];
  let used = 0;
  for (const hunk of hunks.slice(from)) {
    if (used + hunk.chars - 1 > maxChars) break;
    kept.push(hunk);
    used += hunk.chars;
  }
  if (kept.length > 0) return kept;
  const first = hunks[from];
  return first === undefined ? [] : [clipRows(first, maxChars)];
}

/** The view over a chosen set of hunks; `chars` is the whole diff's length. */
function viewOf(hunks: readonly AnnotatedHunk[], chars: number, isClipped: boolean): PatchView {
  const pieces = hunks.flatMap((hunk) => [hunk.header, ...hunk.rows.map((row) => row.text)]);
  const rows = hunks.flatMap((hunk) => hunk.rows);
  // A row with no new-file number contributes to neither answer: a removed
  // line cannot be commented on and cannot be quoted back to a line.
  const newSide = rows.flatMap((row): NewSideEntry[] =>
    row.newLine === null ? [] : [[row.newLine, row.value]],
  );
  const added = new Set(
    rows.flatMap((row): number[] => (row.isAdded && row.newLine !== null ? [row.newLine] : [])),
  );
  return { annotated: pieces.join("\n"), addedLines: added, newSide, chars, clipped: isClipped };
}

/**
 * What to show the model for one file, within `maxChars`.
 *
 * Over budget, the diff is **cut, not dropped**: whole hunks are kept from the
 * first commentable one, and the allowed lines and the anchor haystack
 * describe only what survived the cut.
 */
export function patchView(patch: string, maxChars: number): PatchView {
  const hunks = annotatedHunks(patch);
  const chars = lengthOf(hunks);
  if (chars <= maxChars) return viewOf(hunks, chars, false);
  const kept = clipHunks(hunks, maxChars);
  // `clipped` is measured, not assumed: a budget under the diff's length can
  // still end up showing all of it, because the smallest showable thing is a
  // hunk's rows up to its first added line. Reporting a cut that did not
  // happen would put a file in the run's `truncated` tally for nothing.
  return viewOf(kept, chars, lengthOf(kept) !== chars);
}

/** The whole patch, nothing clipped. */
function fullView(patch: string): PatchView {
  return patchView(patch, Infinity);
}

/** The set of NEW-file line numbers for added (`+`) lines. */
export function addedLines(patch: string): Set<number> {
  return new Set(fullView(patch).addedLines);
}

/**
 * The patch's NEW side as `[line number, text]` pairs, in file order.
 *
 * Both context and added lines are included because a quoted snippet
 * routinely spans the boundary between them -- the model quotes the statement
 * it is talking about, not the diff's idea of what changed. Removed lines are
 * excluded: they have no new-file number to anchor to.
 *
 * This is the haystack the anchor resolver matches a finding's
 * `existing_code` against. Text is returned verbatim (no marker);
 * normalisation belongs to the matcher, which applies the same rules to both
 * sides.
 */
export function newSideIndex(patch: string): NewSideEntry[] {
  return [...fullView(patch).newSide];
}

/**
 * Render the patch with added lines prefixed by their new-file line number.
 *
 * Added lines become `[L<n>] +<content>`; context, removed and hunk-header
 * lines pass through unchanged. This lets the model cite exact, valid line
 * numbers in its findings.
 */
export function annotatePatch(patch: string): string {
  return fullView(patch).annotated;
}
