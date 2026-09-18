/**
 * Which changed files are reviewed, and why each of the others is not.
 *
 * One pure function answers that for a whole change set, and it is the only
 * place the question is answered: `--preview` prints these decisions and the
 * real run reviews them, so the free pre-flight and the paid run cannot
 * disagree about scope. That is the entire reason this module exists -- the
 * exclusions used to be scattered across three files (a credential guard
 * here, an `exclude` glob there, a missing patch in the orchestrator's own
 * loop), which is exactly the shape of code where a preview slowly stops
 * describing the run it is previewing.
 *
 * Two further things fall out of having the decisions in one value:
 *
 * - **Every skip carries a reason**, so "the reviewer ignored my Dockerfile"
 *   is answerable (`excluded`, `no_added_lines`, ...) instead of being
 *   invisible. A run reports the distribution; the preview names it per file.
 * - **The change set handed to the model is the selected set.** A file's
 *   pre-context may quote *other* files' diffs (`context.ts`), so building
 *   that list from the raw input would have let an excluded -- or a
 *   credential -- file reach a prompt as somebody else's "related change".
 *
 * What is deliberately *not* decided here: anything unknowable before the
 * call is made. A model failure, a content fetch that comes back empty, a
 * finding that survives verification -- those are outcomes of reviewing, and
 * a decision function that pretended to know them would be lying to the
 * preview.
 */

import { type FileReviewSettings } from "../config/settings";
import { type ChangedFileRecord, SKIP_STATUSES } from "../domain/changed-file";
import { type Logger, NULL_LOGGER } from "../ports/logger";
import { isGlobMatch } from "../skills/glob";
import { countCodePoints, cutToLength, asText } from "../util/text";

import { ChangedFile } from "./changed-file";
import { addedLines, annotatePatch } from "./diff";
import { isBinaryPatch, isSecretPath } from "./guards";

/**
 * Why a changed file is, or is not, reviewed. `none` means "nothing stood in
 * the way" -- the file is reviewed.
 *
 * The order the reasons are asked in is `GATES`, not the order below, and the
 * first one that answers wins: the two guarantees that are not the project's
 * to make (`secret`, `binary`) are settled before any configuration is
 * consulted.
 *
 * There is no `too_large`: a diff over `max-file-chars` is *cut*, not
 * dropped, so the model still reviews the part it was given. The decision
 * records that as `truncated` instead of pretending the file was skipped.
 */
export type SelectionReason =
  | "none"
  /** The record carried no path or no patch -- there is nothing to review. */
  | "no_patch"
  /** The path names a credential file; its contents are never sent. */
  | "secret"
  /** A patch git could not express as text. */
  | "binary"
  /** A status with nothing to comment on (`removed`, `renamed`). */
  | "status"
  /** Matched one of the project's `exclude` globs. */
  | "excluded"
  /** The patch adds no lines, so no comment could be anchored. */
  | "no_added_lines";

/** Every reason but `none`: the reasons a file is *not* reviewed. */
export type SkipReason = Exclude<SelectionReason, "none">;

/**
 * What every decision carries, whatever it decided.
 *
 * `annotatedPatch` and `addedLines` are carried rather than recomputed
 * because they *are* the decision: the lines a finding may anchor to and the
 * exact diff text the model is shown.
 */
interface DecisionFields {
  readonly path: string;
  readonly status: string;
  /** The line-numbered diff the model is shown, already cut to the cap. */
  readonly annotatedPatch: string;
  /** New-file line numbers a finding may anchor to. */
  readonly addedLines: ReadonlySet<number>;
  /** Length of the annotated diff before the cap was applied. */
  readonly diffChars: number;
  /** Whether `annotatedPatch` is a cut-down view of `diffChars`. */
  readonly truncated: boolean;
}

/** A decision to review: the one shape the per-file step accepts. */
export interface SelectedFile extends DecisionFields {
  readonly reason: "none";
  readonly file: ChangedFile;
}

/** A decision not to review, and the reason why. */
export interface SkippedFile extends DecisionFields {
  readonly reason: SkipReason;
  /** Never a file: a skipped file's contents go nowhere. */
  readonly file: null;
}

/**
 * One changed file's fate, discriminated by `reason`.
 *
 * A union rather than one interface with a nullable `file`, because the two
 * members are the two things a caller does: review a file, or report why it
 * was not reviewed. Written as one shape, "reviewed but there is no file" is
 * a value the type permits and every caller has to null-check past; written
 * as two, it does not exist, and `isSelected` hands each branch the fields
 * that branch actually has.
 */
export type FileDecision = SelectedFile | SkippedFile;

/** Whether this decision is one to review (and typed as such). */
export function isSelected(decision: FileDecision): decision is SelectedFile {
  return decision.reason === "none";
}

function skipped(path: string, status: string, reason: SkipReason): SkippedFile {
  return {
    path,
    status,
    reason,
    file: null,
    annotatedPatch: "",
    addedLines: new Set(),
    diffChars: 0,
    truncated: false,
  };
}

/**
 * One skip question, asked of a file that has already been parsed.
 *
 * `no_patch` is not one of these -- it is the precondition that produces the
 * `ChangedFile` a gate is asked about -- and neither is `no_added_lines`,
 * whose answer (`addedLines`) is kept and handed to the review rather than
 * thrown away. The type says both: a gate names a reason that is neither.
 */
interface SelectionGate {
  readonly reason: Exclude<SkipReason, "no_patch" | "no_added_lines">;
  readonly rejects: (file: ChangedFile, settings: FileReviewSettings) => boolean;
}

/**
 * The skip questions, in the order they are asked; the first `true` wins.
 *
 * The order is the point of writing them as a list: it used to live in the
 * sequence of `if`s and in a comment describing that sequence, which is two
 * statements of one rule and one of them free to rot. Here the rule that
 * `secret` is settled before `excluded` -- a credential the project also
 * excluded is still reported as the credential it is -- is a line of data a
 * reader can check against the reason table above.
 */
const GATES: readonly SelectionGate[] = [
  { reason: "secret", rejects: (file) => isSecretPath(file.path) },
  { reason: "binary", rejects: (file) => isBinaryPatch(file.patch) },
  { reason: "status", rejects: (file) => SKIP_STATUSES.has(file.status) },
  {
    reason: "excluded",
    rejects: (file, settings) => settings.exclude.some((glob) => isGlobMatch(file.path, glob)),
  },
];

/**
 * The decision to review this file, with the diff the model will be shown.
 *
 * Takes `lines` rather than computing them because the caller has already
 * asked the question the answer came from -- "does this patch add anything?"
 * -- and a second walk of the same patch could only disagree with the first.
 */
function reviewed(
  file: ChangedFile,
  lines: ReadonlySet<number>,
  settings: FileReviewSettings,
): SelectedFile {
  const annotated = annotatePatch(file.patch);
  const diffChars = countCodePoints(annotated);
  return {
    path: file.path,
    status: file.status,
    reason: "none",
    file,
    annotatedPatch: cutToLength(annotated, settings.maxFileChars),
    addedLines: lines,
    diffChars,
    truncated: diffChars > settings.maxFileChars,
  };
}

/**
 * Decide one changed file, from the record the diff source reports.
 *
 * Pure: the same record and settings always yield the same decision, and
 * nothing is read, logged or called. A skipped file's diff is never parsed --
 * the cheap answers come first, which is what makes a preview of a large
 * change set cost nothing.
 */
export function decideFile(entry: ChangedFileRecord, settings: FileReviewSettings): FileDecision {
  const file = ChangedFile.fromEntry(entry);
  // The only branch with no `ChangedFile` to name the file by, so it is the
  // only one that has to read the raw record. An absent field reads as "":
  // this decision is reported to a human, and a record with no path has no
  // path rather than one spelled `null`.
  if (file === null) {
    return skipped(asText(entry.filename ?? ""), asText(entry.status ?? ""), "no_patch");
  }

  const gate = GATES.find((candidate) => candidate.rejects(file, settings));
  if (gate !== undefined) return skipped(file.path, file.status, gate.reason);

  const lines = addedLines(file.patch);
  return lines.size === 0
    ? skipped(file.path, file.status, "no_added_lines")
    : reviewed(file, lines, settings);
}

/** Decide a whole change set, in the order it was reported. */
export function selectFiles(
  entries: readonly ChangedFileRecord[],
  settings: FileReviewSettings,
): FileDecision[] {
  return entries.map((entry) => decideFile(entry, settings));
}

/** The files to review, typed so the per-file step needs no null check. */
export function selectedFiles(decisions: readonly FileDecision[]): SelectedFile[] {
  return decisions.filter((decision) => isSelected(decision));
}

/** The files not reviewed, each still carrying why. */
export function skippedFiles(decisions: readonly FileDecision[]): SkippedFile[] {
  return decisions.filter((decision): decision is SkippedFile => !isSelected(decision));
}

/**
 * How many files each reason skipped, reasons that skipped none omitted.
 *
 * This is what makes the exclusions measurable: a run that reviewed 3 of 40
 * files should be able to say what happened to the other 37, and a rule that
 * quietly eats half a change set shows up here first.
 */
export function skipCounts(decisions: readonly FileDecision[]): Map<SkipReason, number> {
  const counts = new Map<SkipReason, number>();
  for (const decision of skippedFiles(decisions)) {
    counts.set(decision.reason, (counts.get(decision.reason) ?? 0) + 1);
  }
  return counts;
}

/**
 * How each reason reads to a human, in the words the logs already used.
 * One table so the log line and the preview row cannot describe the same
 * decision differently.
 */
const SKIP_LABELS: Readonly<Record<SkipReason, string>> = {
  no_patch: "no patch",
  secret: "credential file",
  binary: "binary",
  status: "status",
  excluded: "excluded",
  no_added_lines: "no added lines",
};

/** Why this file was skipped, in a few words (`status` names the status). */
export function skipDetail(decision: SkippedFile): string {
  const label = SKIP_LABELS[decision.reason];
  return decision.reason === "status" ? `${label}=${decision.status}` : label;
}

/**
 * Log what the decisions did, one line per skipped file.
 *
 * Lives here so both flows say the same thing about the same decision. A
 * withheld credential is INFO, not DEBUG: an operator running without `-v`
 * should still be told that something was kept out of the prompt and which
 * file it was. Every other skip is the ordinary course of a review.
 */
export function logSkips(decisions: readonly FileDecision[], logger?: Logger): void {
  const log = (logger ?? NULL_LOGGER).child("review.selection");
  for (const decision of skippedFiles(decisions)) {
    if (decision.reason === "secret") {
      log.info(`skip ${decision.path}: names a credential file; its contents are never sent.`);
      continue;
    }
    log.debug(`skip ${decision.path} (${skipDetail(decision)}).`);
  }
}
