/**
 * Reviewing one selected file: skills, content, pre-context, model, verification. Scope is decided
 * upstream in `selection.ts`.
 * @packageDocumentation
 */

import { type LimitFunction } from "p-limit";

import { type FileReviewSettings } from "../config/settings";
import { type ChangedFile } from "../domain/changed-file";
import { type Finding } from "../domain/finding";
import { type CodeContext } from "../ports/code-context";
import { type Logger, NULL_LOGGER } from "../ports/logger";
import { type RenderedSkills, type SkillMatcher } from "../ports/skill-matcher";
import { countCodePoints, formatCount, show } from "../util/text";
import { type Clock, SYSTEM_CLOCK, seconds, stopwatch } from "../util/timing";

export { DEFAULT_FILE_REVIEW_SETTINGS, type FileReviewSettings } from "../config/settings";

import { EXACT } from "./anchor";
import { type ContextLimits, gatherContext, renderContext } from "./context";
import { type ReviewFileInput } from "./file-reviewer";
import { isSecretPath } from "./guards";
import { type SelectedFile } from "./selection";
import { type VerifyInput, type Verdict, keepAll } from "./verify";

/** Reads a file's full text for prompt context: `(path, status) → text`, or `null` when unavailable. */
export type ContentReader = (path: string, status: string) => Promise<string | null>;

/**
 * A safety ceiling on the file text attached as context, in code points. A file over it is attached
 * whole or not at all, never as a prefix: a head-of-file cut hides the code around the change. A
 * constant, not a setting.
 */
export const MAX_CONTENT_CHARS = 200_000;

/** What the per-file step needs from the model-backed reviewer. */
export interface PerFileReviewer {
  reviewFile(input: ReviewFileInput): Promise<Finding[]>;
}

/** What the per-file step needs from the verification pass. */
export interface PerFileVerifier {
  verify(input: VerifyInput): Promise<Verdict>;
}

/** The outcome for one reviewed file. */
export interface ReviewedFile {
  readonly path: string;
  /** What survived verification. */
  readonly findings: readonly Finding[];
  /** The skills the prompt actually carried; one the budget left out is not among them. */
  readonly skillNames: readonly string[];
  /** How many findings verification removed; `0` without a verifier. */
  readonly refuted: number;
}

/** Options for {@link reviewChangedFile}. */
export interface ReviewChangedFileOptions {
  readonly reviewer: PerFileReviewer;
  /** `null`/absent reports every finding. */
  readonly verifier?: PerFileVerifier | null;
  readonly settings: FileReviewSettings;
  readonly skills: SkillMatcher | null;
  /** Bounds content read + model calls across files. */
  readonly limit: LimitFunction;
  readonly readContent?: ContentReader | null;
  /** Where pre-context is read from; `null` gathers none. */
  readonly codeContext?: CodeContext | null;
  /** Every changed file of the change set, this one included. */
  readonly changeSet?: readonly ChangedFile[];
  /** The per-file cap, passed to the prompt; `0` means all. */
  readonly maxFindingsPerFile?: number;
  readonly logger?: Logger;
  /** The clock timings are read from; injectable for tests. */
  readonly now?: Clock;
}

/** How long each waiting step took, in milliseconds; `verify` is `null` without a verifier. */
interface StepTimings {
  readonly context: number;
  readonly model: number;
  readonly verify: number | null;
}

/** Formats timings as the log states them: `context 0.2s, model 42.3s, verify 18.1s`. */
function describeTimings(timings: StepTimings): string {
  const steps: [string, number | null][] = [
    ["context", timings.context],
    ["model", timings.model],
    ["verify", timings.verify],
  ];
  return steps.flatMap(([name, ms]) => (ms === null ? [] : [`${name} ${seconds(ms)}`])).join(", ");
}

/**
 * Reviews one selected file.
 *
 * @returns The reviewed file, or `null` when the path names a credential file.
 * @remarks The secret check is re-asked here, where the prompt is built, so a hand-built decision cannot leak one.
 * Both model calls share the one concurrency slot.
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

  const verifier = options.verifier ?? null;
  const now = options.now ?? SYSTEM_CLOCK;

  const { verdict, timings, skillNames } = await limit(async () => {
    const content = await contentOf(file, options, log);
    const rendered: RenderedSkills =
      skills === null
        ? { text: "", applied: [] }
        : skills.renderFor(file.path, settings.maxSkillChars);
    const contextElapsed = stopwatch(now);
    const contextText = await surroundingsOf(file, options, log);
    const context = contextElapsed();
    const modelElapsed = stopwatch(now);
    const findings = await reviewer.reviewFile({
      path: file.path,
      annotatedPatch: annotated,
      allowedLines: allowed,
      content,
      language: settings.language,
      skillsText: rendered.text,
      contextText,
      anchorIndex: selected.newSide,
      maxFindings: options.maxFindingsPerFile ?? 0,
    });
    const model = modelElapsed();
    const skillNames = rendered.applied;
    if (verifier === null) {
      return {
        verdict: keepAll(findings),
        timings: { context, model, verify: null },
        skillNames,
      };
    }
    const verifyElapsed = stopwatch(now);
    const checked = await verifier.verify({ path: file.path, annotatedPatch: annotated, findings });
    return {
      verdict: checked,
      timings: { context, model, verify: verifyElapsed() },
      skillNames,
    };
  });

  const refuted = verdict.refuted.length;
  const checked = refuted === 0 ? "" : `, ${refuted} refuted`;
  log.info(
    `review ${file.path}: +${allowed.size} line(s), skills=${show(skillNames)}, ${verdict.kept.length} finding(s)${checked} (${describeTimings(timings)}).`,
  );
  return { path: file.path, findings: verdict.kept, skillNames, refuted };
}

/**
 * The file's full text for the prompt, or `null`.
 *
 * @remarks An added file's patch is the whole file, so content is fetched only for modified files. Text
 * over {@link MAX_CONTENT_CHARS} is withheld whole and said so at INFO; the diff alone is reviewed.
 */
async function contentOf(
  file: ChangedFile,
  options: ReviewChangedFileOptions,
  log: Logger,
): Promise<string | null> {
  const readContent = options.readContent ?? null;
  if (readContent === null || file.status === "added") return null;
  const content = await readContent(file.path, file.status);
  if (content === null) return null;
  const chars = countCodePoints(content);
  if (chars <= MAX_CONTENT_CHARS) return content;
  log.info(
    `content ${file.path}: ${formatCount(chars)} chars exceeds the ${formatCount(MAX_CONTENT_CHARS)} ceiling; the diff alone was reviewed.`,
  );
  return null;
}

/** The pre-context block for one file, or `""`. Failure here never fails the review. */
async function surroundingsOf(
  file: ChangedFile,
  options: ReviewChangedFileOptions,
  log: Logger,
): Promise<string> {
  const codeContext = options.codeContext ?? null;
  const { maxContextChars: maxChars } = options.settings;
  if (codeContext === null || maxChars <= 0) return "";
  const gathered = await gatherContext({
    file,
    changeSet: options.changeSet ?? [file],
    context: codeContext,
    limits: contextLimitsOf(options.settings),
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

/** The configured pre-context budget: every limit comes from the config files, none from the environment. */
export function contextLimitsOf(settings: FileReviewSettings): ContextLimits {
  return {
    maxChars: settings.maxContextChars,
    maxDefinitions: settings.maxDefinitions,
    maxSymbols: settings.maxSymbols,
    maxUsagesPerSymbol: settings.maxUsagesPerSymbol,
    maxRelated: settings.maxRelated,
  };
}

/**
 * Tallies how each finding's line was decided.
 *
 * @returns Anchor outcome → count. A finding with no outcome counts as `exact`.
 */
export function countAnchors(findings: Iterable<Finding>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const finding of findings) {
    const anchor: string = finding.anchor;
    const key = anchor === "" ? EXACT : anchor;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}
