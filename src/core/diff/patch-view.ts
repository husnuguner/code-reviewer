/**
 * Helpers over one file's unified-diff `patch` string.
 *
 * Inline review comments may only anchor to lines that are part of the diff;
 * in practice the reliably commentable lines are the ADDED (`+`) lines,
 * addressed by their NEW-file (target) line number. This module derives the
 * commentable set, the new side as a matchable index, and a line-numbered
 * rendering the model can cite exact line numbers from.
 */

import { type DiffLine, hunkHeader, parseUnifiedDiff } from "./unified-diff";

/** Every line of the patch in order, with its hunk header where one begins. */
function* diffLines(patch: string): Generator<DiffLine | { readonly header: string }> {
  for (const file of parseUnifiedDiff(patch)) {
    for (const hunk of file.hunks) {
      yield { header: hunkHeader(hunk) };
      yield* hunk.lines;
    }
  }
}

/** Only the diff's own lines, hunk headers dropped. */
function* contentLines(patch: string): Generator<DiffLine> {
  for (const item of diffLines(patch)) {
    if (!("header" in item)) yield item;
  }
}

/** The set of NEW-file line numbers for added (`+`) lines. */
export function addedLines(patch: string): Set<number> {
  const result = new Set<number>();
  for (const line of contentLines(patch)) {
    if (line.type === "+" && line.targetLineNo !== null) result.add(line.targetLineNo);
  }
  return result;
}

/** One entry of the new side: `[new-file line number, text]`. */
export type NewSideEntry = readonly [line: number, text: string];

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
  const out: NewSideEntry[] = [];
  for (const line of contentLines(patch)) {
    const isNewSide = line.type === "+" || line.type === " ";
    if (isNewSide && line.targetLineNo !== null) out.push([line.targetLineNo, line.value]);
  }
  return out;
}

/**
 * Render the patch with added lines prefixed by their new-file line number.
 *
 * Added lines become `[L<n>] +<content>`; context, removed and hunk-header
 * lines pass through unchanged. This lets the model cite exact, valid line
 * numbers in its findings.
 */
export function annotatePatch(patch: string): string {
  const out: string[] = [];
  for (const item of diffLines(patch)) {
    if ("header" in item) {
      out.push(item.header);
      continue;
    }
    const rendered = `${item.type}${item.value}`;
    out.push(item.type === "+" ? `[L${item.targetLineNo ?? 0}] ${rendered}` : rendered);
  }
  return out.join("\n");
}
