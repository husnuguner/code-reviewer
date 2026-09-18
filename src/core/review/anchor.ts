/**
 * Anchor a finding to a commentable line using the model's own code quote.
 *
 * Each finding arrives with two independent signals: a `line` the model read
 * off the `[L<n>]` markers in the annotated diff, and `existing_code` -- a
 * verbatim quote of the lines it is talking about. Neither is reliable alone.
 * A line number is easy to mis-copy, and when it lands outside the commentable
 * set the whole finding would be lost. A quote cannot say *which* occurrence
 * it meant when the same code appears twice.
 *
 * Together they resolve. The quote is matched against the diff's new side with
 * a sliding window over non-blank lines; the line number confirms or replaces
 * the result. Four outcomes:
 *
 * - `exact`     the line is commentable and the quote agrees (or is unusable);
 * - `repaired`  the line was missing or not commentable, and the quote matched
 *               exactly one place -- the finding is saved instead of dropped;
 * - `conflict`  the line is commentable but the quote points somewhere else.
 *               The line is kept and the disagreement counted (see below);
 * - `failed`    neither signal yields a commentable line. The caller surfaces
 *               the finding without one rather than discarding it.
 *
 * Why the line wins a conflict: it is copied from a marker printed beside the
 * code, not computed, so a commentable value is usually right -- whereas a
 * quote can match a repeated idiom in one *other* place by luck and look unique
 * while being wrong. Relocating a correct comment is the worse error, so the
 * tie-break favours the marker and the conflict counter records how often the
 * question actually arises.
 */

import { isInteger } from "../util/json";
import { splitLines } from "../util/text";

import { type NewSideEntry } from "./diff";

export const EXACT = "exact";
export const REPAIRED = "repaired";
export const CONFLICT = "conflict";
export const FAILED = "failed";

export type AnchorOutcome = typeof EXACT | typeof REPAIRED | typeof CONFLICT | typeof FAILED;

/**
 * Where a finding may be posted, and how that was decided.
 *
 * `line` is `null` exactly when `outcome` is `failed`. `startLine` is set only
 * for a multi-line anchor, where it is the first line of the span and `line`
 * the last (GitHub's own convention).
 */
export interface Anchor {
  readonly line: number | null;
  readonly startLine: number | null;
  readonly outcome: AnchorOutcome;
}

export interface ResolveInput {
  /** The model's claimed line, untyped straight from its JSON. */
  readonly line: unknown;
  /** The model's verbatim quote of the code it is talking about. */
  readonly existingCode: string;
  /** The diff's new side; empty means the quote cannot be used. */
  readonly index: readonly NewSideEntry[];
  /** The commentable (added) line numbers. */
  readonly allowed: ReadonlySet<number>;
}

// The annotated diff prefixes added lines with `[L<n>] `; a quote copied
// straight out of the prompt carries it, so the tag and the run of space
// after it are removed before a quoted line is compared to a diff line.
const LINE_TAG = /^\[L\d+\]\s*/u;

type Span = readonly [start: number, end: number];

/** One line reduced to its comparable core: no indent, no diff marker. */
function core(text: string): string {
  return text.trim().replace(LINE_TAG, "").trim();
}

/**
 * The forms a quoted line may legitimately take.
 *
 * A quote may or may not carry the `+`/`-` marker of the diff line it was
 * copied from, so both readings are accepted. Stripping the marker
 * unconditionally instead would corrupt real code: `--count;` would become
 * `-count;` on one side of the comparison only.
 */
function quoteForms(text: string): ReadonlySet<string> {
  const stripped = core(text);
  const first = stripped.slice(0, 1);
  const hasMarker = first === "+" || first === "-";
  return new Set(hasMarker ? [stripped, stripped.slice(1).trim()] : [stripped]);
}

/**
 * Split a quote into per-line accepted forms, dropping blank lines.
 *
 * Blanks are dropped on both sides of the match so that an empty line inside
 * the quote -- or inside the diff -- cannot break an otherwise good run.
 */
function quoteLines(existingCode: string): ReadonlySet<string>[] {
  const out: ReadonlySet<string>[] = [];
  for (const raw of splitLines(existingCode)) {
    const forms = quoteForms(raw);
    if ([...forms].some((form) => form !== "")) out.push(forms);
  }
  return out;
}

/**
 * Every run in `index` matching all of `lines` consecutively.
 *
 * All matches are collected, not just the first: a quote matching two places
 * is ambiguous and must not be used to move a comment.
 */
function spans(index: readonly NewSideEntry[], lines: readonly ReadonlySet<string>[]): Span[] {
  const rows = index
    .map(([no, text]) => [no, core(text)] as const)
    .filter(([, text]) => text !== "");
  const width = lines.length;
  if (width === 0 || rows.length < width) return [];
  const hits: Span[] = [];
  for (let start = 0; start <= rows.length - width; start++) {
    const isMatches = lines.every((forms, offset) => forms.has(rows[start + offset]?.[1] ?? ""));
    if (isMatches) hits.push([rows[start]?.[0] ?? 0, rows[start + width - 1]?.[0] ?? 0]);
  }
  return hits;
}

/**
 * Reduce a matched span to the commentable lines inside it.
 *
 * Only added lines are commentable, so a span that caught context lines is
 * narrowed to the added ones it contains. The result stays multi-line only
 * when those added lines form an unbroken run; otherwise it collapses to the
 * first, which keeps a comment from spanning a gap of context.
 */
function postable(span: Span, allowed: ReadonlySet<number>): Span | null {
  const [start, end] = span;
  const inside = [...allowed].filter((n) => start <= n && n <= end).toSorted((a, b) => a - b);
  const first = inside[0];
  const last = inside.at(-1);
  if (first === undefined || last === undefined) return null;
  const isUnbrokenRun = last - first === inside.length - 1 && inside.length > 1;
  return [first, isUnbrokenRun ? last : first];
}

/** An anchor over `span`, single-line when it covers one line. */
function spanAnchor(span: Span, outcome: AnchorOutcome): Anchor {
  const [start, end] = span;
  return { line: end, startLine: end > start ? start : null, outcome };
}

/** Decide where one finding may be posted. Never throws. */
export function resolveAnchor({ line, existingCode, index, allowed }: ResolveInput): Anchor {
  const claimed = isInteger(line) && allowed.has(line) ? line : null;
  const candidates = spans(index, quoteLines(existingCode))
    .map((span) => postable(span, allowed))
    .filter((span): span is Span => span !== null);
  const distinct = new Set(candidates.map(([start, end]) => `${start}:${end}`));
  const unique = distinct.size === 1 ? candidates[0] : undefined;

  if (claimed !== null) {
    // No usable quote, or an ambiguous one: the marker stands on its own.
    if (unique === undefined) return { line: claimed, startLine: null, outcome: EXACT };
    // The quote agrees; widen to the whole span it actually named.
    return unique[0] <= claimed && claimed <= unique[1]
      ? spanAnchor(unique, EXACT)
      : { line: claimed, startLine: null, outcome: CONFLICT };
  }
  return unique === undefined
    ? { line: null, startLine: null, outcome: FAILED }
    : spanAnchor(unique, REPAIRED);
}
