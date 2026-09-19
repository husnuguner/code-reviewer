/**
 * The severity vocabulary, declared once; ranking, labels and gates derive from it.
 * @packageDocumentation
 */

import { ValueError } from "../util/errors";
import { hasContent } from "../util/json";
import { capitalised, asText } from "../util/text";

/** The severities, most severe first. */
export const SEVERITIES = ["bug", "security", "performance", "readability"] as const;

/** One of {@link SEVERITIES}. */
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

/** A raw value trimmed and lower-cased, as every comparison must spell it. */
function normalised(value: unknown): string {
  return (hasContent(value) ? String(value) : "").trim().toLowerCase();
}

/** Whether a raw value names a known severity. */
export function isKnownSeverity(value: unknown): boolean {
  return isSeverity(normalised(value));
}

/** The human label a comment opens with. */
export function severityLabelOf(severity: Severity): string {
  return LABELS[severity];
}

/** `0` for the most severe, increasing from there. */
export function severityRank(severity: Severity): number {
  return RANKS.get(severity) ?? SEVERITIES.length;
}

/**
 * Parses a raw value into a severity.
 *
 * @param value - Text from a model, a command line, or a record stream.
 * @param fallback - Returned when `value` is unknown.
 * @throws {@link ValueError} when `value` is unknown and no fallback is given.
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
 * A gate over the named severities.
 *
 * @param severities - The gate; an empty list matches nothing.
 * @returns A predicate that normalises both sides, so `"Bug"` meets a `bug` gate.
 */
export function severityGate(severities: readonly string[]): (severity: unknown) => boolean {
  const gate = new Set(severities.map((name) => normalised(name)).filter((name) => name !== ""));
  return (severity) => gate.has(normalised(severity));
}

/** The `a|b|c` alternation the prompt shows the model. */
export function severityPromptVocabulary(): string {
  return SEVERITIES.join("|");
}

/** The label for a raw value, or a capitalised echo of an unknown one. */
export function severityLabel(value: unknown): string {
  const text = value === null || value === undefined ? "" : asText(value);
  try {
    return severityLabelOf(parseSeverity(text));
  } catch {
    return capitalised(text);
  }
}
