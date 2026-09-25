/**
 * Which changed files are reviewed, and why each of the others is not. One pure function, consumed by
 * both `--preview` and the real run.
 * @packageDocumentation
 */

import { type FileReviewSettings } from "../config/settings";
import { type NewSideEntry, addedLines, patchView } from "../diff/patch-view";
import { ChangedFile, type ChangedFileRecord, SKIP_STATUSES } from "../domain/changed-file";
import { type Logger, NULL_LOGGER } from "../ports/logger";
import { isGlobMatch } from "../skills/glob";
import { asText, formatCount } from "../util/text";

import { isBinaryPatch, isSecretPath } from "./guards";

/**
 * A safety ceiling on the annotated diff, in code points: a generated or minified file that nobody
 * excluded is skipped, not sent to a model (~50k tokens). A constant, not a setting; the fix is
 * `exclude` or splitting the change.
 */
export const MAX_DIFF_CHARS = 200_000;

/**
 * Why a file is, or is not, reviewed. `none` means reviewed.
 *
 * @remarks Asked in {@link GATES} order; `secret` and `binary` are settled before any configuration.
 * A diff is never cut: one over {@link MAX_DIFF_CHARS} is skipped as `too_large`, and that is the last
 * question asked, so a huge credential file still reads `secret`.
 */
export type SelectionReason =
  | "none"
  /** No path or no patch. */
  | "no_patch"
  /** Names a credential file. */
  | "secret"
  /** A patch git could not express as text. */
  | "binary"
  /** `removed`. */
  | "status"
  /** Matched an `exclude` glob. */
  | "excluded"
  /** No added lines to anchor a comment to. */
  | "no_added_lines"
  /** The annotated diff is over {@link MAX_DIFF_CHARS}. */
  | "too_large";

/** Every reason but `none`. */
export type SkipReason = Exclude<SelectionReason, "none">;

/** What every decision carries. The three diff fields come from one `patchView`, so they agree. */
interface DecisionFields {
  readonly path: string;
  readonly status: string;
  /** The line-numbered diff the model is shown, whole. */
  readonly annotatedPatch: string;
  /** New-file line numbers a finding may anchor to. */
  readonly addedLines: ReadonlySet<number>;
  /** The diff's new side: the anchor haystack. */
  readonly newSide: readonly NewSideEntry[];
  /** Length of the annotated diff in code points; for `too_large`, the size that was refused. */
  readonly diffChars: number;
}

/** A decision to review. */
export interface SelectedFile extends DecisionFields {
  readonly reason: "none";
  readonly file: ChangedFile;
}

/** A decision not to review, and why. */
export interface SkippedFile extends DecisionFields {
  readonly reason: SkipReason;
  /** Never a file: a skipped file's contents go nowhere. */
  readonly file: null;
}

/** One changed file's fate, discriminated by `reason`. */
export type FileDecision = SelectedFile | SkippedFile;

/** Whether this decision is one to review. */
export function isSelected(decision: FileDecision): decision is SelectedFile {
  return decision.reason === "none";
}

function skipped(path: string, status: string, reason: SkipReason, diffChars = 0): SkippedFile {
  return {
    path,
    status,
    reason,
    file: null,
    annotatedPatch: "",
    addedLines: new Set(),
    newSide: [],
    diffChars,
  };
}

/** One skip question asked of a parsed file. */
interface SelectionGate {
  readonly reason: Exclude<SkipReason, "no_patch" | "no_added_lines" | "too_large">;
  readonly rejects: (file: ChangedFile, settings: FileReviewSettings) => boolean;
}

/** The skip questions in the order they are asked; the first `true` wins. */
const GATES: readonly SelectionGate[] = [
  { reason: "secret", rejects: (file) => isSecretPath(file.path) },
  { reason: "binary", rejects: (file) => isBinaryPatch(file.patch) },
  { reason: "status", rejects: (file) => SKIP_STATUSES.has(file.status) },
  {
    reason: "excluded",
    rejects: (file, settings) => settings.exclude.some((glob) => isGlobMatch(file.path, glob)),
  },
];

/** The decision on a file every gate passed: reviewed whole, or `too_large`. */
function reviewed(file: ChangedFile): FileDecision {
  const view = patchView(file.patch);
  if (view.chars > MAX_DIFF_CHARS) {
    return skipped(file.path, file.status, "too_large", view.chars);
  }
  return {
    path: file.path,
    status: file.status,
    reason: "none",
    file,
    annotatedPatch: view.annotated,
    addedLines: view.addedLines,
    newSide: view.newSide,
    diffChars: view.chars,
  };
}

/**
 * Decides one changed file. Pure.
 *
 * @param entry - The record as the diff source reported it.
 * @returns The decision. A file a gate skipped never has its diff parsed.
 */
export function decideFile(entry: ChangedFileRecord, settings: FileReviewSettings): FileDecision {
  const file = ChangedFile.fromEntry(entry);
  if (file === null) {
    return skipped(asText(entry.filename ?? ""), asText(entry.status ?? ""), "no_patch");
  }

  const gate = GATES.find((candidate) => candidate.rejects(file, settings));
  if (gate !== undefined) return skipped(file.path, file.status, gate.reason);

  return addedLines(file.patch).size === 0
    ? skipped(file.path, file.status, "no_added_lines")
    : reviewed(file);
}

/** Decides a whole change set, in the order it was reported. */
export function selectFiles(
  entries: readonly ChangedFileRecord[],
  settings: FileReviewSettings,
): FileDecision[] {
  return entries.map((entry) => decideFile(entry, settings));
}

/** The files to review. */
export function selectedFiles(decisions: readonly FileDecision[]): SelectedFile[] {
  return decisions.filter((decision) => isSelected(decision));
}

/** The files not reviewed, each with its reason. */
export function skippedFiles(decisions: readonly FileDecision[]): SkippedFile[] {
  return decisions.filter((decision): decision is SkippedFile => !isSelected(decision));
}

/** How many files each reason skipped; reasons that skipped none are omitted. */
export function skipCounts(decisions: readonly FileDecision[]): Map<SkipReason, number> {
  const counts = new Map<SkipReason, number>();
  for (const decision of skippedFiles(decisions)) {
    counts.set(decision.reason, (counts.get(decision.reason) ?? 0) + 1);
  }
  return counts;
}

/** How each reason reads to a human; shared by the log and the preview. */
const SKIP_LABELS: Readonly<Record<SkipReason, string>> = {
  no_patch: "no patch",
  secret: "credential file",
  binary: "binary",
  status: "status",
  excluded: "excluded",
  no_added_lines: "no added lines",
  too_large: "too large",
};

/** Why this file was skipped, in a few words; `status` names the status, `too_large` the size and the fix. */
export function skipDetail(decision: SkippedFile): string {
  const label = SKIP_LABELS[decision.reason];
  if (decision.reason === "status") return `${label}=${decision.status}`;
  return decision.reason === "too_large"
    ? `${label} (${formatCount(decision.diffChars)} chars; exclude it or split the change)`
    : label;
}

/**
 * Logs one line per skipped file. A withheld credential and a `too_large` file at INFO, because the
 * operator must act on them; everything else at DEBUG.
 */
export function logSkips(decisions: readonly FileDecision[], logger?: Logger): void {
  const log = (logger ?? NULL_LOGGER).child("review.selection");
  for (const decision of skippedFiles(decisions)) {
    if (decision.reason === "secret") {
      log.info(`skip ${decision.path}: names a credential file; its contents are never sent.`);
      continue;
    }
    if (decision.reason === "too_large") {
      log.info(`skip ${decision.path} (${skipDetail(decision)}).`);
      continue;
    }
    log.debug(`skip ${decision.path} (${skipDetail(decision)}).`);
  }
}
