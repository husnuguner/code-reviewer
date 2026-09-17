/**
 * The severity vocabulary, declared once.
 *
 * Everything that needs to know what a severity is -- validation, ranking,
 * the human label, the vocabulary shown to the model -- derives from the one
 * declaration below. The order *is* the declaration order: a new member goes
 * where it belongs in significance, not at the end.
 */

import { ValueError } from "../util/errors";
import { isPyTruthy, pyString, pyStrip, pyTitle } from "../util/py";

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
  const text = pyStrip(isPyTruthy(value) ? pyString(value) : "").toLowerCase();
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

/** The `a|b|c` alternation the prompt shows the model. */
export function severityPromptVocabulary(): string {
  return SEVERITIES.join("|");
}

/** The label for a raw value, falling back to a title-cased echo of it. */
export function severityLabel(value: unknown): string {
  const text = value === null || value === undefined ? "" : pyString(value);
  try {
    return severityLabelOf(parseSeverity(text));
  } catch {
    return pyTitle(text);
  }
}
