/**
 * Anchors a finding to a commentable line from two signals: the model's `line` and its `existing_code` quote.
 * @packageDocumentation
 */

import { type NewSideEntry } from "../diff/patch-view";
import { isInteger } from "../util/json";
import { splitLines } from "../util/text";

/** The line is commentable and the quote agrees or is unusable. */
export const EXACT = "exact";
/** The line was unusable; the quote matched exactly one place. */
export const REPAIRED = "repaired";
/** The line is commentable but the quote points elsewhere; the line is kept. */
export const CONFLICT = "conflict";
/** Neither signal yields a line. */
export const FAILED = "failed";

/** How a finding's line was decided. */
export type AnchorOutcome = typeof EXACT | typeof REPAIRED | typeof CONFLICT | typeof FAILED;

/** Where a finding may be posted. `line` is `null` exactly when `outcome` is `failed`. */
export interface Anchor {
  readonly line: number | null;
  /** First line of a multi-line anchor; `null` for a single line. */
  readonly startLine: number | null;
  readonly outcome: AnchorOutcome;
}

/** Input to {@link resolveAnchor}. */
export interface ResolveInput {
  /** The model's claimed line, untyped from its JSON. */
  readonly line: unknown;
  /** The model's verbatim quote. */
  readonly existingCode: string;
  /** The diff's new side; empty disables the quote. */
  readonly index: readonly NewSideEntry[];
  /** The commentable line numbers. */
  readonly allowed: ReadonlySet<number>;
}

/** A `[L<n>] ` prefix copied out of the prompt. */
const LINE_TAG = /^\[L\d+\]\s*/u;

type Span = readonly [start: number, end: number];

/** A line's comparable core: trimmed, no line tag. */
function core(text: string): string {
  return text.trim().replace(LINE_TAG, "").trim();
}

/** The forms a quoted line may take: with or without a leading `+`/`-` marker. */
function quoteForms(text: string): ReadonlySet<string> {
  const stripped = core(text);
  const first = stripped.slice(0, 1);
  const hasMarker = first === "+" || first === "-";
  return new Set(hasMarker ? [stripped, stripped.slice(1).trim()] : [stripped]);
}

/** The quote as per-line accepted forms, blank lines dropped. */
function quoteLines(existingCode: string): ReadonlySet<string>[] {
  const out: ReadonlySet<string>[] = [];
  for (const raw of splitLines(existingCode)) {
    const forms = quoteForms(raw);
    if ([...forms].some((form) => form !== "")) out.push(forms);
  }
  return out;
}

/** Every run in `index` matching all of `lines` consecutively (blank rows skipped). */
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

/** Narrows a span to the commentable lines inside it; multi-line only when they form an unbroken run. */
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

/**
 * Decides where one finding may be posted. Never throws.
 *
 * @returns The anchor and its outcome. A commentable `line` wins a conflict with the quote; a quote
 * repairs a missing or uncommentable line only when it matches exactly one place.
 */
export function resolveAnchor({ line, existingCode, index, allowed }: ResolveInput): Anchor {
  const claimed = isInteger(line) && allowed.has(line) ? line : null;
  const candidates = spans(index, quoteLines(existingCode))
    .map((span) => postable(span, allowed))
    .filter((span): span is Span => span !== null);
  const distinct = new Set(candidates.map(([start, end]) => `${start}:${end}`));
  const unique = distinct.size === 1 ? candidates[0] : undefined;

  if (claimed !== null) {
    if (unique === undefined) return { line: claimed, startLine: null, outcome: EXACT };
    return unique[0] <= claimed && claimed <= unique[1]
      ? spanAnchor(unique, EXACT)
      : { line: claimed, startLine: null, outcome: CONFLICT };
  }
  return unique === undefined
    ? { line: null, startLine: null, outcome: FAILED }
    : spanAnchor(unique, REPAIRED);
}
