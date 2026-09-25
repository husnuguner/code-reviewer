/**
 * One file's patch as the model is shown it: the annotated diff, the commentable lines and the
 * anchor haystack, computed together from one text so they cannot disagree. A stretch the author took
 * out of review leaves all three at once, one placeholder line standing where it was.
 * @packageDocumentation
 */

import { countCodePoints } from "../util/text";

import { type Elision, elisionAt, elisionLine } from "./elision";
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

/** One hunk as it is shown. */
interface AnnotatedHunk {
  readonly header: string;
  readonly rows: readonly Row[];
}

/** What the model is shown for one file, and the answers derived from exactly that text. */
export interface PatchView {
  /** The line-numbered diff, whole. */
  readonly annotated: string;
  /** New-file line numbers a finding may anchor to. */
  readonly addedLines: ReadonlySet<number>;
  /** The diff's new side, in file order. */
  readonly newSide: readonly NewSideEntry[];
  /** Length of `annotated` in code points. */
  readonly chars: number;
  /** How many diff rows an elision replaced; `0` when the whole patch is shown. */
  readonly elided: number;
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

/** Every hunk of the patch, rendered, in file order. */
function annotatedHunks(patch: string): AnnotatedHunk[] {
  const out: AnnotatedHunk[] = [];
  for (const file of parseUnifiedDiff(patch)) {
    for (const hunk of file.hunks) {
      out.push({ header: hunkHeader(hunk), rows: hunk.lines.map((line) => rowOf(line)) });
    }
  }
  return out;
}

/**
 * Which elision each row of a hunk falls in, by position; `null` for a row that is shown.
 *
 * @remarks A row with no new-side number -- a removed line, the no-newline marker -- goes with the
 * next new-side row of the hunk: a diff puts what was removed before what replaced it, so those lines
 * are the old body of the block that follows. Trailing such rows go with the row before them.
 */
function elisionsByRow(rows: readonly Row[], elisions: readonly Elision[]): (Elision | null)[] {
  const ofRow = (row: Row): Elision | null =>
    row.newLine === null ? null : elisionAt(row.newLine, elisions);
  const lastNewSide = rows.findLast((row) => row.newLine !== null);
  // Walked backwards so each numberless row sees the new-side row that follows it; the rows after
  // the last new-side one start from that one's elision.
  let following: Elision | null = lastNewSide === undefined ? null : ofRow(lastNewSide);
  const out: (Elision | null)[] = Array.from({ length: rows.length }, () => null);
  for (let index = rows.length - 1; index >= 0; index--) {
    const row = rows[index];
    if (row !== undefined && row.newLine !== null) following = ofRow(row);
    out[index] = following;
  }
  return out;
}

/** One hunk as shown: its rows with every elided run replaced by one line, and how many rows that took. */
interface ShownHunk {
  readonly header: string;
  readonly rows: readonly Row[];
  readonly replaced: number;
}

/** The hunk with every elided run replaced by its one line. */
function shownHunk(hunk: AnnotatedHunk, elisions: readonly Elision[]): ShownHunk {
  if (elisions.length === 0) return { ...hunk, replaced: 0 };
  const byRow = elisionsByRow(hunk.rows, elisions);
  const rows: Row[] = [];
  let replaced = 0;
  let current: Elision | null = null;
  for (const [index, row] of hunk.rows.entries()) {
    const elision = byRow[index] ?? null;
    if (elision === null) {
      rows.push(row);
    } else {
      replaced += 1;
      if (elision !== current) {
        rows.push({ text: elisionLine(elision), newLine: null, isAdded: false, value: "" });
      }
    }
    current = elision;
  }
  return { header: hunk.header, rows, replaced };
}

/**
 * What to show the model for one file: the whole patch, annotated, less any elided stretch.
 *
 * @param patch - The file's unified-diff patch.
 * @param elisions - New-side stretches to leave out, each replaced by one line naming it; none by default.
 * @returns The view; `addedLines` and `newSide` describe `annotated` and nothing else, so a line that
 * is not shown is neither commentable nor an anchor.
 */
export function patchView(patch: string, elisions: readonly Elision[] = []): PatchView {
  const hunks = annotatedHunks(patch).map((hunk) => shownHunk(hunk, elisions));
  const pieces = hunks.flatMap((hunk) => [hunk.header, ...hunk.rows.map((row) => row.text)]);
  const rows = hunks.flatMap((hunk) => hunk.rows);
  const newSide = rows.flatMap((row): NewSideEntry[] =>
    row.newLine === null ? [] : [[row.newLine, row.value]],
  );
  const added = new Set(
    rows.flatMap((row): number[] => (row.isAdded && row.newLine !== null ? [row.newLine] : [])),
  );
  const annotated = pieces.join("\n");
  const elided = hunks.reduce((sum, hunk) => sum + hunk.replaced, 0);
  return { annotated, addedLines: added, newSide, chars: countCodePoints(annotated), elided };
}

/** The new-file line numbers of the added lines. */
export function addedLines(patch: string): Set<number> {
  return new Set(patchView(patch).addedLines);
}

/**
 * The patch's new side as `[line, text]` pairs, in file order.
 *
 * @remarks Context and added lines both; removed lines have no new-file number. Text is verbatim,
 * normalisation is the matcher's.
 */
export function newSideIndex(patch: string): NewSideEntry[] {
  return [...patchView(patch).newSide];
}

/** The patch with added lines prefixed `[L<n>] +`; other lines pass through. */
export function annotatePatch(patch: string): string {
  return patchView(patch).annotated;
}
