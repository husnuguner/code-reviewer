/**
 * One file's patch as the model is shown it: the annotated diff, the commentable lines and the
 * anchor haystack, computed together from one text so they cannot disagree.
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
 * What to show the model for one file: the whole patch, annotated.
 *
 * @param patch - The file's unified-diff patch.
 * @returns The view; `addedLines` and `newSide` describe `annotated` and nothing else.
 */
export function patchView(patch: string): PatchView {
  const hunks = annotatedHunks(patch);
  const pieces = hunks.flatMap((hunk) => [hunk.header, ...hunk.rows.map((row) => row.text)]);
  const rows = hunks.flatMap((hunk) => hunk.rows);
  const newSide = rows.flatMap((row): NewSideEntry[] =>
    row.newLine === null ? [] : [[row.newLine, row.value]],
  );
  const added = new Set(
    rows.flatMap((row): number[] => (row.isAdded && row.newLine !== null ? [row.newLine] : [])),
  );
  const annotated = pieces.join("\n");
  return { annotated, addedLines: added, newSide, chars: countCodePoints(annotated) };
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
