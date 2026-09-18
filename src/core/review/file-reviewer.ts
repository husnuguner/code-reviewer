/**
 * Model-backed per-file reviewer: annotated diff in, anchored findings out.
 *
 * This is the ONLY place the language model is consulted. It returns
 * structured findings; the flow decides what to report.
 *
 * No finding leaves this module with a line the caller cannot report on. A line
 * the model got wrong is first re-derived from the code it quoted (see
 * `anchor.ts`); only when that fails too does the finding come back with
 * `line: null`, which asks the caller to report it without a line rather than
 * to discard it.
 */

import { type NewSideEntry } from "../diff/patch-view";
import { type Finding } from "../domain/finding";
import { type ChatMessage, type ChatModel, type ChatResponse } from "../ports/chat-model";
import { type Logger, NULL_LOGGER } from "../ports/logger";
import { errorMessage } from "../util/errors";
import { type JsonValue, decodeJson, hasContent, isJsonArray, isJsonObject } from "../util/json";
import { asText, collapseWhitespace, cutToLength, show } from "../util/text";
import { type Clock, SYSTEM_CLOCK, describeUsage, seconds, stopwatch } from "../util/timing";

import { type Anchor, CONFLICT, EXACT, FAILED, REPAIRED, resolveAnchor } from "./anchor";
import { RETRY_PROMPT, buildUserPrompt, reviewMessages } from "./prompts";
import { isKnownSeverity, parseSeverity, severityPromptVocabulary } from "./severity";

/**
 * The severity a finding keeps when the model named one the vocabulary has
 * not got: the mildest, so that a substitution cannot inflate a finding's
 * standing. What was claimed is recorded on the finding (`severity_claimed`)
 * and counted by the run.
 */
const FALLBACK_SEVERITY = "readability";

/** Model text that does not contain a findings object. */
export class JsonDecodeError extends Error {
  override readonly name = "JSONDecodeError";
}

const FENCE = /^```(?:json)?\s*([^]*?)\s*```$/u;

/**
 * The span from the first `{` to the last `}`, or `null`.
 *
 * A missing brace makes `indexOf` answer -1, which the ordering check rejects
 * along with a `}` that precedes the `{`.
 */
function outermostObject(text: string): string | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start === -1 || end <= start ? null : text.slice(start, end + 1);
}

function parseJson(text: string): JsonValue {
  return decodeJson(text, (detail) => new JsonDecodeError(detail));
}

/** Parse a findings payload from model text, tolerating stray fences/prose. */
export function extractJson(raw: string): JsonValue {
  let text = raw.trim();
  const fenced = FENCE.exec(text);
  if (fenced?.[1] !== undefined) text = fenced[1].trim();
  try {
    return parseJson(text);
  } catch (error) {
    // Fall back to the outermost {...} span, tolerating prose around it.
    const span = outermostObject(text);
    if (span === null) throw error;
    return parseJson(span);
  }
}

export interface ReviewFileInput {
  readonly path: string;
  readonly annotatedPatch: string;
  readonly allowedLines: ReadonlySet<number>;
  readonly content: string | null;
  /** Human language for each finding's `body` (default English). */
  readonly language?: string;
  readonly skillsText?: string;
  /** The rendered pre-context block, if any. */
  readonly contextText?: string;
  /**
   * The diff's new side from `newSideIndex`, used to place a finding from the
   * code it quoted; omitting it leaves the model's line number as the only
   * anchor.
   */
  readonly anchorIndex?: readonly NewSideEntry[];
  /** How many findings the run will report for this file; `0` asks for no limit. */
  readonly maxFindings?: number;
}

export interface FileReviewerOptions {
  /** The composed system prompt (`systemPrompt(policy, contract)`). */
  readonly systemPrompt: string;
  readonly logger?: Logger;
  /** The clock each call's duration is read from; injected so a test can pin it. */
  readonly now?: Clock;
}

/** Wraps the chat model to produce validated findings for one file. */
export class FileReviewer {
  private readonly log: Logger;
  private readonly systemPrompt: string;
  private readonly now: Clock;

  constructor(
    private readonly model: ChatModel,
    options: FileReviewerOptions,
  ) {
    this.log = (options.logger ?? NULL_LOGGER).child("review.file_reviewer");
    this.systemPrompt = options.systemPrompt;
    this.now = options.now ?? SYSTEM_CLOCK;
  }

  /** Anchored findings for one file (`[]` on any failure). */
  async reviewFile(input: ReviewFileInput): Promise<Finding[]> {
    if (input.allowedLines.size === 0) return [];

    const userPrompt = buildUserPrompt({
      path: input.path,
      annotatedPatch: input.annotatedPatch,
      allowedLines: [...input.allowedLines].toSorted((a, b) => a - b),
      content: input.content,
      language: input.language ?? "English",
      contextText: input.contextText ?? "",
      maxFindings: input.maxFindings ?? 0,
    });
    // Stable prefix first (standing prompt, then this file's skills), the
    // file itself last: see `reviewMessages` for why the order matters.
    const messages = reviewMessages(this.systemPrompt, input.skillsText ?? "", userPrompt);

    const payload = await this.askForFindings(input.path, messages);
    if (!isJsonObject(payload)) return [];

    const items = payload["findings"];
    return isJsonArray(items) ? items.flatMap((item) => this.toFinding(input, item)) : [];
  }

  /**
   * The model's parsed payload, or `undefined` when it could not be had.
   *
   * A malformed payload costs the whole file, so it is retried once (asking
   * for JSON only) before giving up on it.
   */
  private async askForFindings(
    path: string,
    initial: readonly ChatMessage[],
  ): Promise<JsonValue | undefined> {
    let messages = initial;
    for (const attempt of [1, 2] as const) {
      let response: ChatResponse;
      // Timed per attempt, so that a retried file shows as two waits rather
      // than one long one -- the one line that tells a slow model from a
      // malformed answer paid for twice.
      const elapsed = stopwatch(this.now);
      try {
        response = await this.model.generate(messages);
      } catch (error) {
        this.log.warn(
          `LLM call failed for ${path} after ${seconds(elapsed())}: ${errorMessage(error)}`,
        );
        return undefined;
      }
      const took = elapsed();
      const cost = describeUsage(response.usage, took);
      this.log.debug(
        `${path}: the model answered in ${seconds(took)} (attempt ${attempt} of 2${cost === "" ? "" : `; ${cost}`}).`,
      );
      const raw = response.text;
      try {
        return extractJson(raw);
      } catch (error) {
        if (attempt === 2) {
          this.log.warn(`Could not parse findings JSON for ${path}: ${errorMessage(error)}`);
          return undefined;
        }
        this.log.info(
          `Malformed findings JSON for ${path} (${errorMessage(error)}); retrying once.`,
        );
        messages = [...messages, { role: "user", content: RETRY_PROMPT }];
      }
    }
    return undefined;
  }

  /** One raw finding item as a validated, anchored `Finding` -- or nothing. */
  private toFinding(input: ReviewFileInput, item: JsonValue): Finding[] {
    if (!isJsonObject(item)) return [];
    const body = asText(item["body"] ?? "").trim();
    if (body === "") return [];
    // An unrecognised severity keeps the finding under the mildest one rather
    // than losing it: the text is the model's, the problem it describes may
    // still be real. What it claimed is kept and said out loud, because
    // re-rating a finding in silence is still re-rating it.
    const named = item["severity"];
    const severity = parseSeverity(named, FALLBACK_SEVERITY);
    // A claim the vocabulary has not got was *overruled*, and that travels
    // with the finding so a run can count it. A claim never made was not
    // overruled -- there was nothing to overrule -- so it is said out loud
    // and left out of the tally.
    const claimedSeverity =
      hasContent(named) && !isKnownSeverity(named) ? collapseWhitespace(asText(named)) : "";
    if (!isKnownSeverity(named)) {
      this.log.info(
        `${input.path}: severity ${show(hasContent(named) ? asText(named) : "(none)")} is not one of ${severityPromptVocabulary()}; keeping the finding as ${severity}.`,
      );
    }
    const quote = hasContent(item["existing_code"]) ? asText(item["existing_code"]) : "";
    const claimed = item["line"];
    const spot = resolveAnchor({
      line: claimed,
      existingCode: quote,
      index: input.anchorIndex ?? [],
      allowed: input.allowedLines,
    });
    this.logAnchor(input.path, claimed, quote, spot);
    return [
      {
        line: spot.line,
        severity,
        body,
        example: hasContent(item["example"]) ? asText(item["example"]).trim() : "",
        start_line: spot.startLine,
        anchor: spot.outcome,
        existing_code: quote,
        severity_claimed: claimedSeverity,
      },
    ];
  }

  /**
   * Record how a finding's line was decided, when it was not simply right.
   *
   * These are INFO, not WARNING: a repair is the mechanism working, and a
   * conflict is data being gathered. Only a finding that could not be placed
   * at all rises to WARNING, since that is the one a reader may need to chase.
   */
  private logAnchor(path: string, claimed: unknown, quote: string, spot: Anchor): void {
    const line = spot.line ?? 0;
    switch (spot.outcome) {
      case REPAIRED: {
        const where = spot.startLine === null ? String(line) : `${spot.startLine}-${line}`;
        this.log.info(
          `${path}: line ${show(claimed)} was not commentable; the quoted code places the finding at ${where} instead.`,
        );
        break;
      }
      case CONFLICT: {
        this.log.info(
          `${path}: the quoted code matches somewhere other than line ${line}; keeping the line the model reported.`,
        );
        break;
      }
      case FAILED: {
        const shortQuote = cutToLength(collapseWhitespace(quote), 80);
        this.log.warn(
          `${path}: could not place a finding (line ${show(claimed)}, quote ${show(shortQuote)}); reporting it without a line.`,
        );
        break;
      }
      case EXACT: {
        break;
      }
    }
  }
}
