/**
 * Reviewing one selected file: skills, content, pre-context, model, verification. Scope is decided
 * upstream in `selection.ts`.
 * @packageDocumentation
 */

import { type LimitFunction } from "p-limit";

import { type FileReviewSettings } from "../config/settings";
import { elideLines } from "../diff/elision";
import { type NewSideEntry, patchView } from "../diff/patch-view";
import { type ChangedFile } from "../domain/changed-file";
import { type Finding } from "../domain/finding";
import { type CodeContext } from "../ports/code-context";
import { type Logger, NULL_LOGGER } from "../ports/logger";
import { type RenderedSkills, type SkillMatcher } from "../ports/skill-matcher";
import { countCodePoints, formatCount, show } from "../util/text";
import { type Clock, SYSTEM_CLOCK, seconds, stopwatch } from "../util/timing";

export { DEFAULT_FILE_REVIEW_SETTINGS, type FileReviewSettings } from "../config/settings";

import { EXACT } from "./anchor";
import {
  type BypassMarker,
  type BypassRegion,
  countBypassed,
  isMarkdownPath,
  isWhollyBypassed,
  scanBypass,
} from "./bypass";
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
  /** What survived the bypass markers and verification. */
  readonly findings: readonly Finding[];
  /** The skills the prompt actually carried; one the budget left out is not among them. */
  readonly skillNames: readonly string[];
  /** How many findings verification removed; `0` without a verifier. */
  readonly refuted: number;
  /** How many added lines lay in a bypassed region and were not shown to the model. */
  readonly bypassed: number;
  /** The regions `reviewer: by-pass` markers took out of review in this file. */
  readonly bypassRegions: readonly BypassRegion[];
  /** Markers this change added to the file itself; not honoured until merged. */
  readonly addedMarkers: readonly BypassMarker[];
}

/**
 * What became of one selected file.
 *
 * - `reviewed`: the model was asked and answered.
 * - `guarded`: the path names a credential file; nothing was read or sent (counted under `secret`).
 * - `bypassed`: every added line lies in a bypassed region, so there was nothing to ask about; the
 *   model was not called (the file counted under `skipped.bypassed`, its `lines` under `bypassed`).
 */
export type FileOutcome =
  | { readonly kind: "reviewed"; readonly file: ReviewedFile }
  | { readonly kind: "guarded"; readonly path: string }
  | {
      readonly kind: "bypassed";
      readonly path: string;
      readonly regions: readonly BypassRegion[];
      /** The added lines, every one of them in a region. */
      readonly lines: number;
      /** Markers this change added to the file itself; not honoured until merged. */
      readonly addedMarkers: readonly BypassMarker[];
    };

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
  /**
   * The new-side lines the change under review added to this file, relative to what it merges into; a
   * bypass marker on one of them is not honoured. Omitted: the reviewed diff's added lines, which are the
   * same thing except for a `--since` run, whose diff starts later than the change does.
   */
  readonly changeAddedLines?: ReadonlySet<number>;
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
 * @returns What became of it: reviewed, guarded as a credential file, or bypassed whole.
 * @remarks The secret check is re-asked here, where the prompt is built, so a hand-built decision cannot leak one.
 * Both model calls share the one concurrency slot. Bypass markers are read before the model is asked, and
 * the regions they name leave the diff, the allowed lines, the anchor haystack and the file text before
 * either call: neither model reads a bypassed line, so no finding can land on one.
 */
export async function reviewChangedFile(
  selected: SelectedFile,
  options: ReviewChangedFileOptions,
): Promise<FileOutcome> {
  const { reviewer, settings, skills, limit } = options;
  const log = (options.logger ?? NULL_LOGGER).child("review.changed_file");
  const { file, addedLines: allowed } = selected;

  if (isSecretPath(file.path)) {
    log.info(`skip ${file.path}: names a credential file; its contents are never sent.`);
    return { kind: "guarded", path: file.path };
  }

  const verifier = options.verifier ?? null;
  const now = options.now ?? SYSTEM_CLOCK;

  const outcome = await limit(async (): Promise<ModelRound> => {
    const text = await newSideOf(selected, options, log);
    const changeAdded = options.changeAddedLines ?? allowed;
    const { regions, added: addedMarkers } = bypassRegionsOf(selected, text, {
      settings,
      changeAdded,
      log,
    });
    const bypassed = countBypassed(allowed, regions);
    if (isWhollyBypassed(allowed, regions)) {
      return { kind: "bypassed", regions, lines: bypassed, addedMarkers };
    }
    const shown = shownDiff(selected, regions);
    const content = promptContentOf(file, text, regions, log);
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
      annotatedPatch: shown.annotated,
      allowedLines: shown.allowed,
      hasBypassedLines: shown.elided > 0,
      content,
      language: settings.language,
      skillsText: rendered.text,
      contextText,
      anchorIndex: shown.newSide,
      maxFindings: options.maxFindingsPerFile ?? 0,
    });
    const model = modelElapsed();
    const skillNames = rendered.applied;
    const base = { kind: "reviewed" as const, skillNames, regions, bypassed, addedMarkers };
    if (verifier === null) {
      return { ...base, verdict: keepAll(findings), timings: { context, model, verify: null } };
    }
    const verifyElapsed = stopwatch(now);
    const checked = await verifier.verify({
      path: file.path,
      annotatedPatch: shown.annotated,
      findings,
    });
    return { ...base, verdict: checked, timings: { context, model, verify: verifyElapsed() } };
  });

  if (outcome.kind === "bypassed") {
    log.info(
      `skip ${file.path}: every added line lies in a bypassed region; the model was not called.`,
    );
    return {
      kind: "bypassed",
      path: file.path,
      regions: outcome.regions,
      lines: outcome.lines,
      addedMarkers: outcome.addedMarkers,
    };
  }
  const { verdict, timings, skillNames, regions, bypassed, addedMarkers } = outcome;
  const refuted = verdict.refuted.length;
  const checked = refuted === 0 ? "" : `, ${refuted} refuted`;
  const hidden = bypassed === 0 ? "" : `, ${bypassed} bypassed`;
  log.info(
    `review ${file.path}: +${allowed.size} line(s)${hidden}, skills=${show(skillNames)}, ${verdict.kept.length} finding(s)${checked} (${describeTimings(timings)}).`,
  );
  return {
    kind: "reviewed",
    file: {
      path: file.path,
      findings: verdict.kept,
      skillNames,
      refuted,
      bypassed,
      bypassRegions: regions,
      addedMarkers,
    },
  };
}

/** What the concurrency-limited round of one file produced: a model answer, or no call at all. */
type ModelRound =
  | {
      readonly kind: "reviewed";
      readonly verdict: Verdict;
      readonly timings: StepTimings;
      readonly skillNames: readonly string[];
      readonly regions: readonly BypassRegion[];
      readonly bypassed: number;
      readonly addedMarkers: readonly BypassMarker[];
    }
  | {
      readonly kind: "bypassed";
      readonly regions: readonly BypassRegion[];
      readonly lines: number;
      readonly addedMarkers: readonly BypassMarker[];
    };

/** The diff as the model is shown it, with the same three answers the selection carried. */
interface ShownDiff {
  readonly annotated: string;
  readonly allowed: ReadonlySet<number>;
  readonly newSide: readonly NewSideEntry[];
  /** How many diff rows the regions replaced; `0` when none of them touched the diff. */
  readonly elided: number;
}

/**
 * The selected diff, less the bypassed regions.
 *
 * @remarks Recomputed from the patch as one `patchView`, so the annotated text, the allowed lines and
 * the anchor haystack still describe one another: a line that is not shown is not commentable and
 * cannot place a quote.
 */
function shownDiff(selected: SelectedFile, regions: readonly BypassRegion[]): ShownDiff {
  if (regions.length === 0) {
    return {
      annotated: selected.annotatedPatch,
      allowed: selected.addedLines,
      newSide: selected.newSide,
      elided: 0,
    };
  }
  const view = patchView(selected.file.patch, regions);
  return {
    annotated: view.annotated,
    allowed: view.addedLines,
    newSide: view.newSide,
    elided: view.elided,
  };
}

/** The file's new side, whole, as lines; `null` when it could not be read. */
interface NewSideText {
  /** Line `n` is `lines[n - 1]`. */
  readonly lines: readonly string[];
  /** The text as read, for the prompt. */
  readonly text: string;
}

/**
 * The file's whole new side.
 *
 * @remarks An added file's patch is the whole file, so its lines come from the diff; a modified file's
 * are read from the checkout. `null` when a modified file could not be read.
 */
async function newSideOf(
  selected: SelectedFile,
  options: ReviewChangedFileOptions,
  log: Logger,
): Promise<NewSideText | null> {
  const { file } = selected;
  if (file.status === "added") {
    const length = Math.max(0, ...selected.newSide.map(([line]) => line));
    const lines = Array.from({ length }, () => "");
    for (const [line, text] of selected.newSide) lines[line - 1] = text;
    return { lines, text: lines.join("\n") };
  }
  const readContent = options.readContent ?? null;
  if (readContent === null) return null;
  const text = await readContent(file.path, file.status);
  if (text === null) {
    log.debug(`content ${file.path}: could not be read; the diff alone was reviewed.`);
    return null;
  }
  return { lines: fileLines(text), text };
}

/** Lines as git numbers them: split on `\n` alone, a trailing newline producing no extra line. */
function fileLines(text: string): string[] {
  const lines = text.split("\n").map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

/**
 * The file's full text for the prompt, or `null`.
 *
 * @remarks An added file's patch is the whole file, so content is attached only for modified files. A
 * bypassed region leaves the text as it leaves the diff, one line standing where it was. Text over
 * {@link MAX_CONTENT_CHARS} is withheld whole and said so at INFO; the diff alone is reviewed.
 */
function promptContentOf(
  file: ChangedFile,
  text: NewSideText | null,
  regions: readonly BypassRegion[],
  log: Logger,
): string | null {
  if (text === null || file.status === "added") return null;
  const shown = regions.length === 0 ? text.text : elideLines(text.lines, regions).join("\n");
  const chars = countCodePoints(shown);
  if (chars <= MAX_CONTENT_CHARS) return shown;
  log.info(
    `content ${file.path}: ${formatCount(chars)} chars exceeds the ${formatCount(MAX_CONTENT_CHARS)} ceiling; the diff alone was reviewed.`,
  );
  return null;
}

/**
 * The regions `reviewer: by-pass` markers take out of this file's review, each logged; `[]` when the
 * setting is off or the file could not be read.
 *
 * @remarks With the whole file unavailable a block's end cannot be found, and guessing it from the hunks
 * alone would bypass too much or too little; the markers are then not honoured, and the log says so.
 */
function bypassRegionsOf(
  selected: SelectedFile,
  text: NewSideText | null,
  how: {
    readonly settings: FileReviewSettings;
    /** The lines the change added, relative to what it merges into. */
    readonly changeAdded: ReadonlySet<number>;
    readonly log: Logger;
  },
): { regions: readonly BypassRegion[]; added: readonly BypassMarker[] } {
  const { path } = selected;
  const { settings, log } = how;
  const none = { regions: [], added: [] };
  if (text === null) {
    const visible = scanBypass(selected.newSide.map(([, line]) => line));
    if (visible.regions.length > 0 || visible.unreasoned.length > 0) {
      log.warn(`${path}: could not be read whole; its bypass markers were not honoured.`);
    }
    return none;
  }
  const scan = scanBypass(text.lines, {
    addedLines: how.changeAdded,
    isMarkdown: isMarkdownPath(path),
  });
  if (!settings.bypassMarkers) {
    if (scan.regions.length > 0 || scan.unreasoned.length > 0 || scan.added.length > 0) {
      log.info(`${path}: bypass markers present, but bypass-markers is off; reviewed in full.`);
    }
    return none;
  }
  for (const line of scan.unreasoned) {
    log.warn(`${path}:${line}: 'reviewer: by-pass' without a reason; not honoured.`);
  }
  for (const marker of scan.added) {
    log.warn(
      `${path}:${marker.line}: 'reviewer: by-pass' added by this change; not honoured until it is merged (${marker.reason}).`,
    );
  }
  for (const region of scan.regions) {
    log.info(`${path}: lines ${region.start}-${region.end} bypassed (${region.reason}).`);
  }
  return { regions: scan.regions, added: scan.added };
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
