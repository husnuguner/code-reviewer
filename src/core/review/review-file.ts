/**
 * Reviewing one changed file: the step every review is made of.
 *
 * What happens to one changed file -- match its skills, fetch its full text
 * and its surroundings for context, ask the model, check the answer -- lives
 * here once, so a second flow (another diff source, another sink) reuses the
 * judgement rather than restating it.
 *
 * Whether the file is reviewed at all is *not* decided here: this step takes
 * a `SelectedFile`, the decision `selection.ts` already made, carrying the
 * annotated diff and the lines a finding may anchor to. One function decides
 * scope so that `--preview` and the real run cannot disagree about it.
 *
 * How a file's full text is read stays the caller's to inject, as a
 * `ContentReader`; today the working tree is what answers it.
 */

import { type LimitFunction } from "p-limit";

import { type FileReviewSettings } from "../config/settings";
import { newSideIndex } from "../diff/patch-view";
import { type ChangedFile } from "../domain/changed-file";
import { type Finding } from "../domain/finding";
import { type CodeContext } from "../ports/code-context";
import { type Logger, NULL_LOGGER } from "../ports/logger";
import { type SkillMatcher } from "../ports/skill-matcher";
import { show } from "../util/text";

// The settings group lives with the other groups; re-exported here because
// this is where callers of the per-file step look for it.
export { DEFAULT_FILE_REVIEW_SETTINGS, type FileReviewSettings } from "../config/settings";

import { EXACT } from "./anchor";
import { DEFAULT_CONTEXT_LIMITS, gatherContext, renderContext } from "./context";
import { type ReviewFileInput } from "./file-reviewer";
import { isSecretPath } from "./guards";
import { type SelectedFile } from "./selection";
import { type VerifyInput, type Verdict, keepAll } from "./verify";

/**
 * Reads a file's full text for prompt context: `(path, status) -> text`.
 * `null` means "no context available", which costs the file nothing but the
 * extra context. Callers own the transport; branch review reads the working
 * tree.
 */
export type ContentReader = (path: string, status: string) => Promise<string | null>;

/** What the per-file step needs from the model-backed reviewer. */
export interface PerFileReviewer {
  reviewFile(input: ReviewFileInput): Promise<Finding[]>;
}

/**
 * What the per-file step needs from the verification pass: the findings that
 * survive being checked against the diff. A flow given none reports every
 * finding the reviewer produced.
 */
export interface PerFileVerifier {
  verify(input: VerifyInput): Promise<Verdict>;
}

/** The outcome for one file that was actually reviewed. */
export interface ReviewedFile {
  readonly path: string;
  /** What survived verification; the only findings a flow reports. */
  readonly findings: readonly Finding[];
  readonly skillNames: readonly string[];
  /** How many findings the verification pass removed (`0` without one). */
  readonly refuted: number;
}

export interface ReviewChangedFileOptions {
  readonly reviewer: PerFileReviewer;
  /** Checks the findings against the diff; `null`/absent reports them all. */
  readonly verifier?: PerFileVerifier | null;
  readonly settings: FileReviewSettings;
  readonly skills: SkillMatcher | null;
  /** Bounds the expensive part (content read + model call) across files. */
  readonly limit: LimitFunction;
  readonly readContent?: ContentReader | null;
  /**
   * Where pre-context is read from (imported modules, users of changed
   * exports); `null` gathers none. Needs `changeSet` for the related diffs.
   */
  readonly codeContext?: CodeContext | null;
  /** Every changed file of the change set, this one included. */
  readonly changeSet?: readonly ChangedFile[];
  readonly logger?: Logger;
}

/**
 * Review one selected file, or return `null` when it must not be reviewed.
 *
 * The scope decision was already made (`selection.ts`), so `null` has exactly
 * one cause left, and it is the one worth paying for twice: a path that names
 * a credential file. That check is re-asked here, where the prompt is
 * actually built, because a secret that reaches a model provider cannot be
 * recalled -- a caller that hand-builds a decision, or a future flow that
 * forgets to select, still cannot leak one (see `guards.ts`).
 */
export async function reviewChangedFile(
  selected: SelectedFile,
  options: ReviewChangedFileOptions,
): Promise<ReviewedFile | null> {
  const { reviewer, settings, skills, limit } = options;
  const log = (options.logger ?? NULL_LOGGER).child("review.changed_file");
  const { file, annotatedPatch: annotated, addedLines: allowed } = selected;

  if (isSecretPath(file.path)) {
    log.info(`skip ${file.path}: names a credential file; its contents are never sent.`);
    return null;
  }

  const skillNames = skills === null ? [] : skills.skillsFor(file.path).map((s) => s.name);
  const verifier = options.verifier ?? null;

  // Both model calls share the one slot: verification is part of this file's
  // work, so letting it run outside the limit would raise how much is in
  // flight beyond what the caller asked for.
  const verdict = await limit(async () => {
    // An added file's patch already IS the whole file, so a separate content
    // block would only duplicate it in the prompt. Context is fetched for
    // modified files, where the patch is a partial view.
    const readContent = options.readContent ?? null;
    const content =
      readContent !== null && file.status !== "added"
        ? await readContent(file.path, file.status)
        : null;
    const skillsText =
      skills === null
        ? ""
        : skills.renderFor(file.path, settings.maxSkillChars, settings.maxSkillsTotalChars);
    const contextText = await surroundingsOf(file, options, log);
    const findings = await reviewer.reviewFile({
      path: file.path,
      annotatedPatch: annotated,
      allowedLines: allowed,
      content,
      language: settings.language,
      skillsText,
      contextText,
      anchorIndex: newSideIndex(file.patch),
    });
    return verifier === null
      ? keepAll(findings)
      : verifier.verify({ path: file.path, annotatedPatch: annotated, findings });
  });

  const refuted = verdict.refuted.length;
  const checked = refuted === 0 ? "" : `, ${refuted} refuted`;
  log.info(
    `review ${file.path}: +${allowed.size} line(s), skills=${show(skillNames)}, ${verdict.kept.length} finding(s)${checked}.`,
  );
  return { path: file.path, findings: verdict.kept, skillNames, refuted };
}

/**
 * The pre-context block for one file, or "" when none is configured, none is
 * available, or nothing was found. Failure here never fails the review.
 */
async function surroundingsOf(
  file: ChangedFile,
  options: ReviewChangedFileOptions,
  log: Logger,
): Promise<string> {
  const codeContext = options.codeContext ?? null;
  const maxChars = options.settings.maxContextChars;
  if (codeContext === null || maxChars <= 0) return "";
  const gathered = await gatherContext({
    file,
    changeSet: options.changeSet ?? [file],
    context: codeContext,
    limits: { ...DEFAULT_CONTEXT_LIMITS, maxChars },
    ...(options.logger && { logger: options.logger }),
  });
  const text = renderContext(gathered, maxChars);
  if (text !== "") {
    log.debug(
      `context ${file.path}: ${gathered.definitions.length} definition(s), ${gathered.usages.length} symbol(s) with users, ${gathered.related.length} related diff(s), ${text.length} chars.`,
    );
  }
  return text;
}

/**
 * Tally how each finding's line was decided (see `anchor.ts`).
 *
 * This is what makes the anchoring measurable: without it a repaired line is
 * indistinguishable from one the model got right.
 */
export function countAnchors(findings: Iterable<Finding>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const finding of findings) {
    // A finding built without an outcome (e.g. by a test double) counts as exact.
    const anchor: string = finding.anchor;
    const key = anchor === "" ? EXACT : anchor;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}
