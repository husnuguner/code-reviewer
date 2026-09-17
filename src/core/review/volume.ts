/**
 * How many findings one file reports, and what happens to the rest.
 *
 * The one volume decision this reviewer makes. It is deliberately tiny and
 * deliberately separate from the model call: a cap that lived inside the
 * reviewer would make "the model found nothing" and "the cap ate it"
 * indistinguishable, and a reader cannot act on a number that means two
 * things.
 *
 * Two rules, both of them the point:
 *
 * 1. **Severity decides who survives.** When a file is over its cap, the
 *    findings that stay are the most severe ones -- a readability note must
 *    never crowd out a security bug just by arriving first.
 * 2. **What is cut is counted, never hidden.** The caller gets the number
 *    back and reports it, because a finding that disappears without a tally
 *    is the failure mode that makes a cap untrustworthy.
 */

import { type Finding } from "../domain/finding";

import { severityRankOf } from "./severity";

/** Findings kept for one file, and how many the cap removed. */
export interface CappedFindings {
  readonly kept: readonly Finding[];
  /** How many findings the cap removed; `0` when it did not bite. */
  readonly capped: number;
}

/**
 * Keep at most `maxPerFile` findings, most severe first; `0` keeps them all.
 *
 * Ties are broken by line so that two runs over the same findings cut the
 * same ones -- an unstable cap would make a diff of two reports unreadable.
 * An unanchored finding (`line: null`) sorts last within its severity: it is
 * the one a reader can act on least directly.
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
