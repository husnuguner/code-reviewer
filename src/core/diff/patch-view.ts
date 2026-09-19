/**
 * One file's patch as the model is shown it: the annotated diff, the commentable lines and the
 * anchor haystack, computed together so a cut diff cannot advertise a line it does not contain.
 * @packageDocumentation
 */

import { countCodePoints } from "../util/text";

import { type DiffLine, hunkHeader, parseUnifiedDiff } from "./unified-diff";

/** One entry of the new side: `[new-file line number, text]`. */
export type NewSideEntry = readonly [line: number, text: string];

/** One rendered row of a hunk. */
interface Row {
  /** The row as printed (`[L12] +foo()`). */
  readonly text: string;
  /** Its new-file line number, or `null` for a removed line or the no-newline marker. */
  readonly newLine: number | null;
  readonly isAdded: boolean;
  /** The line verbatim, no marker: the anchor haystack's side. */
  readonly value: string;
}

/** One hunk as it would be shown, and what showing it costs. */
interface AnnotatedHunk {
  readonly header: string;
  readonly rows: readonly Row[];
  /** Code points of header and rows, newlines included. */
  readonly chars: number;
  /** Whether a finding could be anchored inside it. */
  readonly isCommentable: boolean;
}

/** What the model is shown for one file, and the answers derived from exactly that text. */
export interface PatchView {
  /** The line-numbered diff, whole hunks only, within budget. */
  readonly annotated: string;
  /** New-file line numbers a finding may anchor to, as shown. */
  readonly addedLines: ReadonlySet<number>;
  /** The shown text's new side, in file order. */
  readonly newSide: readonly NewSideEntry[];
  /** Length of the whole annotated diff before clipping. */
  readonly chars: number;
  /** Whether `annotated` shows less than the whole diff. */
  readonly clipped: boolean;
}

/** One diff line as a row of the rendering. */
function rowOf(line: DiffLine): Row {
  const rendered = `${line.type}${line.value}`;
  const isAdded = line.type === "+";
  const isNewSide = isAdded || line.type === " ";
  return {
    text: isAdded ? `[L${line.targetLineNo ?? 0}] ${rendered}` : rendered,
    newLine: isNewSide ? line.targetLineNo : null,
    isAdded,
    value: line.value,
  };
}

/** Code points one piece costs, its newline included. */
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

/** The joined length of the hunks, no trailing newline. */
function lengthOf(hunks: readonly AnnotatedHunk[]): number {
  const total = hunks.reduce((sum, hunk) => sum + hunk.chars, 0);
  return total === 0 ? 0 : total - 1;
}

/**
 * Cuts one hunk at a line boundary.
 *
 * @remarks Exceeds the budget in one case: when no added row fits, rows up to the first one are kept anyway,
 * so the shown text always has something commentable.
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
 * The whole hunks that fit in `maxChars`, from the first commentable one.
 *
 * @remarks Leading hunks with no added line are skipped. When not even one hunk fits, the first is cut at a
 * line boundary via {@link clipRows}.
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
 * @param patch - The file's unified-diff patch.
 * @param maxChars - The code-point budget; `Infinity` for the whole diff.
 * @returns The view. Over budget, whole hunks are kept from the first commentable one; nothing is dropped silently.
 * @remarks `clipped` is measured, not assumed: a small budget can still show the whole diff.
 */
export function patchView(patch: string, maxChars: number): PatchView {
  const hunks = annotatedHunks(patch);
  const chars = lengthOf(hunks);
  if (chars <= maxChars) return viewOf(hunks, chars, false);
  const kept = clipHunks(hunks, maxChars);
  return viewOf(kept, chars, lengthOf(kept) !== chars);
}

/** The whole patch, nothing clipped. */
function fullView(patch: string): PatchView {
  return patchView(patch, Infinity);
}

/** The new-file line numbers of the added lines. */
export function addedLines(patch: string): Set<number> {
  return new Set(fullView(patch).addedLines);
}

/**
 * The patch's new side as `[line, text]` pairs, in file order.
 *
 * @remarks Context and added lines both; removed lines have no new-file number. Text is verbatim,
 * normalisation is the matcher's.
 */
export function newSideIndex(patch: string): NewSideEntry[] {
  return [...fullView(patch).newSide];
}

/** The patch with added lines prefixed `[L<n>] +`; other lines pass through. */
export function annotatePatch(patch: string): string {
  return fullView(patch).annotated;
}
