/**
 * Per-file finding cap: the most severe survive, the rest are counted.
 * @packageDocumentation
 */

import { type Finding } from "../domain/finding";

import { severityRankOf } from "./severity";

/** Result of capping one file's findings. */
export interface CappedFindings {
  /** The findings that survived, most severe first. */
  readonly kept: readonly Finding[];
  /** How many the cap removed; `0` when it did not bite. */
  readonly capped: number;
}

/**
 * Keeps at most `maxPerFile` findings, most severe first.
 *
 * @param findings - The findings reported for one file.
 * @param maxPerFile - The cap; `0` keeps all.
 * @returns The kept findings and how many were removed.
 * @remarks Ties break by line, unanchored last, so two runs cut the same ones.
 */
export function capPerFile(findings: readonly Finding[], maxPerFile: number): CappedFindings {
  if (maxPerFile <= 0 || findings.length <= maxPerFile) return { kept: findings, capped: 0 };
  const ordered = findings.toSorted(
    (a, b) =>
      severityRankOf(a.severity) - severityRankOf(b.severity) ||
      (a.line ?? Number.MAX_SAFE_INTEGER) - (b.line ?? Number.MAX_SAFE_INTEGER),
  );
  return { kept: ordered.slice(0, maxPerFile), capped: findings.length - maxPerFile };
}
