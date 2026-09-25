/**
 * The model-backed per-file reviewer: annotated diff in, anchored findings out. The only place the
 * model is asked for findings.
 * @packageDocumentation
 */

import { type NewSideEntry } from "../diff/patch-view";
import { type Finding } from "../domain/finding";
import { type ChatMessage, type ChatModel, type ChatResponse } from "../ports/chat-model";
import { type Logger, NULL_LOGGER } from "../ports/logger";
import { errorMessage } from "../util/errors";
import { type JsonValue, decodeJson, hasContent, isJsonArray, isJsonObject } from "../util/json";
import {
  asText,
  collapseWhitespace,
  countCodePoints,
  cutToLength,
  formatCount,
  show,
} from "../util/text";
import { type Clock, SYSTEM_CLOCK, describeUsage, seconds, stopwatch } from "../util/timing";

import { type Anchor, CONFLICT, EXACT, FAILED, REPAIRED, resolveAnchor } from "./anchor";
import { RETRY_PROMPT, buildUserPrompt, reviewMessages } from "./prompts";
import { isKnownSeverity, parseSeverity, severityPromptVocabulary } from "./severity";

/** The severity a finding keeps when the model named an unknown one: the mildest. */
const FALLBACK_SEVERITY = "readability";

/** Model text that does not contain a findings object. */
export class JsonDecodeError extends Error {
  override readonly name = "JSONDecodeError";
}

/**
 * A file the model was asked about and did not answer: the call failed, or its reply held no findings
 * list even after one retry. Thrown, not returned as `[]`, so the run counts the file as `failed`
 * rather than as reviewed and clean.
 */
export class ReviewCallError extends Error {
  override readonly name = "ReviewCallError";
}

const FENCE = /^```(?:json)?\s*([^]*?)\s*```$/u;

/** The span from the first `{` to the last `}`, or `null`. */
function outermostObject(text: string): string | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start === -1 || end <= start ? null : text.slice(start, end + 1);
}

function parseJson(text: string): JsonValue {
  return decodeJson(text, (detail) => new JsonDecodeError(detail));
}

/**
 * The `findings` list of a parsed reply.
 *
 * @throws {@link JsonDecodeError} when the reply is not an object carrying a list under `findings`: an
 * answer outside the contract says nothing about whether the file is clean.
 */
function findingsList(payload: JsonValue): readonly JsonValue[] {
  const items = isJsonObject(payload) ? payload["findings"] : undefined;
  if (!isJsonArray(items)) throw new JsonDecodeError("the reply holds no 'findings' list");
  return items;
}

/** How much text a conversation sends, in code points. */
function promptChars(messages: readonly ChatMessage[]): number {
  return messages.reduce((sum, message) => sum + countCodePoints(message.content), 0);
}

/**
 * Parses a findings payload from model text, tolerating a code fence or surrounding prose.
 *
 * @throws {@link JsonDecodeError} when no JSON object can be found.
 */
export function extractJson(raw: string): JsonValue {
  let text = raw.trim();
  const fenced = FENCE.exec(text);
  if (fenced?.[1] !== undefined) text = fenced[1].trim();
  try {
    return parseJson(text);
  } catch (error) {
    const span = outermostObject(text);
    if (span === null) throw error;
    return parseJson(span);
  }
}

/** Input to {@link FileReviewer.reviewFile}. */
export interface ReviewFileInput {
  readonly path: string;
  readonly annotatedPatch: string;
  readonly allowedLines: ReadonlySet<number>;
  /** Whether the diff carries a `[bypassed …]` line where a region was left out; told to the model. */
  readonly hasBypassedLines?: boolean;
  readonly content: string | null;
  /** Language for each finding's `body`; default English. */
  readonly language?: string;
  readonly skillsText?: string;
  /** The rendered pre-context block, if any. */
  readonly contextText?: string;
  /** The shown diff's new side, for placing a finding from its quote; omitted leaves the model's line alone. */
  readonly anchorIndex?: readonly NewSideEntry[];
  /** The per-file cap told to the model; `0` asks for no limit. */
  readonly maxFindings?: number;
}

/** Options for {@link FileReviewer}. */
export interface FileReviewerOptions {
  /** The composed system prompt. */
  readonly systemPrompt: string;
  readonly logger?: Logger;
  /** The clock call durations are read from; injectable for tests. */
  readonly now?: Clock;
}

/** Wraps a chat model to produce validated, anchored findings for one file. */
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

  /**
   * Reviews one file.
   *
   * @returns Anchored findings; `[]` when the model found nothing or there is nothing commentable.
   * @throws {@link ReviewCallError} when the model could not be had: a failed call (retries are the
   * model's decorator's), or a reply that twice held no findings list. An unanswered file is not a clean one.
   */
  async reviewFile(input: ReviewFileInput): Promise<Finding[]> {
    if (input.allowedLines.size === 0) return [];

    const userPrompt = buildUserPrompt({
      path: input.path,
      annotatedPatch: input.annotatedPatch,
      allowedLines: [...input.allowedLines].toSorted((a, b) => a - b),
      hasBypassedLines: input.hasBypassedLines ?? false,
      content: input.content,
      language: input.language ?? "English",
      contextText: input.contextText ?? "",
      maxFindings: input.maxFindings ?? 0,
    });
    const messages = reviewMessages(this.systemPrompt, input.skillsText ?? "", userPrompt);

    const items = await this.askForFindings(input.path, messages);
    return items.flatMap((item) => this.toFinding(input, item));
  }

  /**
   * The model's findings list, retried once when the reply holds none.
   *
   * @throws {@link ReviewCallError} when the call fails or the retry holds none either. The message names
   * the prompt's size, the first thing to check when a vendor refuses a prompt over its context window.
   */
  private async askForFindings(
    path: string,
    initial: readonly ChatMessage[],
  ): Promise<readonly JsonValue[]> {
    let messages = initial;
    const size = `prompt ${formatCount(promptChars(initial))} chars`;
    for (const attempt of [1, 2] as const) {
      let response: ChatResponse;
      const elapsed = stopwatch(this.now);
      try {
        response = await this.model.generate(messages, { responseFormat: "json" });
      } catch (error) {
        throw new ReviewCallError(
          `the model call failed after ${seconds(elapsed())} (${size}): ${errorMessage(error)}`,
          { cause: error },
        );
      }
      const took = elapsed();
      const cost = describeUsage(response.usage, took);
      this.log.debug(
        `${path}: the model answered in ${seconds(took)} (attempt ${attempt} of 2${cost === "" ? "" : `; ${cost}`}).`,
      );
      try {
        return findingsList(extractJson(response.text));
      } catch (error) {
        if (attempt === 2) {
          throw new ReviewCallError(
            `the model's reply held no findings JSON, twice: ${errorMessage(error)}`,
            { cause: error },
          );
        }
        this.log.info(
          `Malformed findings JSON for ${path} (${errorMessage(error)}); retrying once.`,
        );
        messages = [...messages, { role: "user", content: RETRY_PROMPT }];
      }
    }
    // Unreachable: the second attempt returns or throws.
    throw new ReviewCallError("the model was not asked");
  }

  /** One raw item as a validated, anchored finding, or nothing when it has no body. */
  private toFinding(input: ReviewFileInput, item: JsonValue): Finding[] {
    if (!isJsonObject(item)) return [];
    const body = asText(item["body"] ?? "").trim();
    if (body === "") return [];
    const named = item["severity"];
    const severity = parseSeverity(named, FALLBACK_SEVERITY);
    // A claim outside the vocabulary was overruled and is recorded; a claim never made is not.
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

  /** Logs how a line was decided: repairs and conflicts at INFO, a failure at WARN. */
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
