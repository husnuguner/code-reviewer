/**
 * The severity vocabulary, declared once.
 *
 * Everything that needs to know what a severity is -- validation, ranking,
 * the human label, the vocabulary shown to the model -- derives from the one
 * declaration below. The order *is* the declaration order: a new member goes
 * where it belongs in significance, not at the end.
 */

import { ValueError } from "../util/errors";
import { hasContent } from "../util/json";
import { capitalised, asText } from "../util/text";

/** What kind of problem a finding reports, most severe first. */
export const SEVERITIES = ["bug", "security", "performance", "readability"] as const;

export type Severity = (typeof SEVERITIES)[number];

const LABELS: Readonly<Record<Severity, string>> = {
  bug: "Bug/correctness",
  security: "Security",
  performance: "Performance",
  readability: "Readability",
};

const RANKS: ReadonlyMap<string, number> = new Map(
  SEVERITIES.map((severity, index) => [severity, index]),
);

function isSeverity(text: string): text is Severity {
  return RANKS.has(text);
}

/**
 * A raw severity value spelled the way the vocabulary spells it: stripped and
 * lower-cased.
 *
 * One function because a severity arrives from three places that agree about
 * nothing else -- a model's JSON, a command line, and a record stream read
 * off disk -- and every comparison in this program has to treat those three
 * the same way.
 */
function normalised(value: unknown): string {
  return (hasContent(value) ? String(value) : "").trim().toLowerCase();
}

/** The human label a comment opens with. */
export function severityLabelOf(severity: Severity): string {
  return LABELS[severity];
}

/** 0 for the most severe, increasing from there. */
export function severityRank(severity: Severity): number {
  return RANKS.get(severity) ?? SEVERITIES.length;
}

/**
 * The member for a raw value, or `fallback` when it is not one.
 *
 * The model's output is text and occasionally wrong; `fallback` lets a caller
 * keep the finding under a conservative severity rather than lose it. With no
 * fallback, an unknown value throws a `ValueError`.
 */
export function parseSeverity(value: unknown, fallback?: Severity): Severity {
  const text = normalised(value);
  if (isSeverity(text)) return text;
  if (fallback === undefined) {
    throw new ValueError(`'${text}' is not a valid Severity`);
  }
  return fallback;
}

/** Rank for a raw value; unknown values sort after every known one. */
export function severityRankOf(value: unknown): number {
  try {
    return severityRank(parseSeverity(value));
  } catch {
    return SEVERITIES.length;
  }
}

/**
 * A severity gate: whether a finding carries one of the severities a caller
 * named.
 *
 * Both sides are normalised here, and that is the entire reason this exists.
 * The two gates in this program -- `--fail-on`, which decides an exit code,
 * and `--request-changes-on`, which decides a review's verdict -- each used
 * to normalise one side and trust the other, and they chose opposite sides.
 * A gate value can be trusted (`severityList` validates it against the
 * vocabulary); a finding's severity cannot, because a record stream read off
 * disk carries whatever was written into it. So a finding spelled
 * `{"severity": "Bug"}` did not meet a `bug` gate -- a gate that fails open,
 * which is the one way a gate must not fail.
 *
 * An empty gate matches nothing: a caller who named no severity asked for no
 * gate, and that is not the same as asking for every one.
 */
export function severityGate(severities: readonly string[]): (severity: unknown) => boolean {
  const gate = new Set(severities.map((name) => normalised(name)).filter((name) => name !== ""));
  return (severity) => gate.has(normalised(severity));
}

/** The `a|b|c` alternation the prompt shows the model. */
export function severityPromptVocabulary(): string {
  return SEVERITIES.join("|");
}

/** The label for a raw value, falling back to a title-cased echo of it. */
export function severityLabel(value: unknown): string {
  const text = value === null || value === undefined ? "" : asText(value);
  try {
    return severityLabelOf(parseSeverity(text));
  } catch {
    return capitalised(text);
  }
}
