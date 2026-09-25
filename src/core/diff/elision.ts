/**
 * Lines left out of what the model is shown, and the one line that stands where they were. The diff
 * view and the attached file text both render a left-out stretch the same way, so a bypassed block
 * reads alike wherever it would have appeared.
 * @packageDocumentation
 */

/** A stretch of new-side lines that is not shown, both ends inclusive, and why. */
export interface Elision {
  readonly start: number;
  readonly end: number;
  /** The author's reason, as the marker gave it; never empty. */
  readonly reason: string;
}

/**
 * The line that stands where a stretch was: `[bypassed lines 11-50: reason]`.
 *
 * @remarks Deliberately not shaped like an added line's `[L<n>]` prefix, so the model cannot read it
 * as a line it may comment on.
 */
export function elisionLine(elision: Elision): string {
  const where =
    elision.start === elision.end
      ? `line ${elision.start}`
      : `lines ${elision.start}-${elision.end}`;
  return `[bypassed ${where}: ${elision.reason}]`;
}

/** The elision that holds new-side line `line`, or `null`. */
export function elisionAt(line: number, elisions: readonly Elision[]): Elision | null {
  return elisions.find((elision) => elision.start <= line && line <= elision.end) ?? null;
}

/**
 * The text with every elided stretch replaced by its line.
 *
 * @param lines - The file's lines; line `n` is `lines[n - 1]`.
 * @returns The lines to show, one {@link elisionLine} per stretch met.
 * @remarks Two stretches that touch keep their own lines: they are two decisions with two reasons.
 */
export function elideLines(lines: readonly string[], elisions: readonly Elision[]): string[] {
  if (elisions.length === 0) return [...lines];
  const out: string[] = [];
  // The last line number the stretch just written already covers.
  let coveredThrough = 0;
  for (const [index, line] of lines.entries()) {
    const number = index + 1;
    if (number <= coveredThrough) continue;
    const elision = elisionAt(number, elisions);
    if (elision === null) {
      out.push(line);
      continue;
    }
    out.push(elisionLine(elision));
    coveredThrough = elision.end;
  }
  return out;
}
