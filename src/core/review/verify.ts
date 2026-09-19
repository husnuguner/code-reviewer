/**
 * The verification pass: a second model call that removes findings the diff itself refutes. It may
 * only remove, never edit, and fails open.
 * @packageDocumentation
 */

import { type Finding } from "../domain/finding";
import { type ChatMessage, type ChatModel, type ChatResponse } from "../ports/chat-model";
import { type Logger, NULL_LOGGER } from "../ports/logger";
import { errorMessage } from "../util/errors";
import { type JsonValue, hasContent, isInteger, isJsonArray, isJsonObject } from "../util/json";
import { asText, collapseWhitespace } from "../util/text";
import { type Clock, SYSTEM_CLOCK, describeUsage, seconds, stopwatch } from "../util/timing";

import { extractJson } from "./file-reviewer";

/** One file's findings with the diff they came from. */
export interface VerifyInput {
  readonly path: string;
  /** The same annotated diff the reviewer saw. */
  readonly annotatedPatch: string;
  readonly findings: readonly Finding[];
}

/** One removed finding and the ground given. */
export interface Refutation {
  readonly finding: Finding;
  /** `"A"` (not in the diff), `"B"` (contradicted), or `""` when none was given. */
  readonly ground: string;
  /** The verifier's one-sentence evidence, or `""`. */
  readonly reason: string;
}

/** What survived verification, and what did not. */
export interface Verdict {
  readonly kept: readonly Finding[];
  readonly refuted: readonly Refutation[];
}

/** The verdict that removes nothing; the answer to every failure. */
export function keepAll(findings: readonly Finding[]): Verdict {
  return { kept: [...findings], refuted: [] };
}

/** One validated entry of the model's `remove` list. */
export interface Removal {
  /** 1-based position in the list the prompt showed. */
  readonly index: number;
  readonly ground: string;
  readonly reason: string;
}

/** The grounds the policy admits. */
const GROUNDS: ReadonlySet<string> = new Set(["A", "B"]);

function oneLine(text: string): string {
  return collapseWhitespace(text);
}

/** One removal entry, or `null` when unusable. A bare integer is a removal without a ground. */
function removalFrom(item: JsonValue): Removal | null {
  if (isInteger(item)) return { index: item, ground: "", reason: "" };
  if (!isJsonObject(item)) return null;
  const index = item["index"];
  if (!isInteger(index)) return null;
  const ground = (hasContent(item["ground"]) ? asText(item["ground"]) : "").trim().toUpperCase();
  const reason = oneLine(hasContent(item["reason"]) ? asText(item["reason"]) : "");
  return { index, ground: GROUNDS.has(ground) ? ground : "", reason };
}

/**
 * The removals a reply asks for, by index.
 *
 * @param count - How many findings the prompt listed.
 * @returns Valid removals keyed by 1-based index. Every malformed entry is dropped, keeping its finding.
 */
export function removalsFrom(payload: JsonValue, count: number): Map<number, Removal> {
  const removals = new Map<number, Removal>();
  if (!isJsonObject(payload)) return removals;
  const items = payload["remove"];
  if (!isJsonArray(items)) return removals;
  for (const item of items) {
    const removal = removalFrom(item);
    if (removal === null || removal.index < 1 || removal.index > count) continue;
    if (!removals.has(removal.index)) removals.set(removal.index, removal);
  }
  return removals;
}

/** Where a finding sits, as the prompt states it. */
function whereOf(finding: Finding): string {
  if (finding.line === null) return "no line";
  return finding.start_line === null
    ? `line ${finding.line}`
    : `lines ${finding.start_line}-${finding.line}`;
}

/** One finding as the numbered list shows it. */
function entryOf(index: number, finding: Finding): string {
  const lines = [
    `${index}. [${finding.severity}] ${whereOf(finding)}`,
    `   says: ${oneLine(finding.body)}`,
  ];
  const quote = finding.existing_code.trim();
  if (quote !== "") {
    lines.push("   quotes:");
    for (const line of quote.split("\n")) lines.push(`     ${line}`);
  }
  return lines.join("\n");
}

/** Composes the verification call's user prompt. */
export function buildVerifyPrompt({ path, annotatedPatch, findings }: VerifyInput): string {
  return [
    `File: ${path}`,
    "",
    "Unified diff (added lines prefixed with [L<n>]):",
    "```diff",
    annotatedPatch,
    "```",
    "",
    "Findings to check:",
    "",
    ...findings.map((finding, index) => entryOf(index + 1, finding)),
    "",
    "Return the removal JSON now.",
  ].join("\n");
}

/** Options for {@link FindingVerifier}. */
export interface FindingVerifierOptions {
  /** The verification policy (`prompts/verify.md`). */
  readonly systemPrompt: string;
  readonly logger?: Logger;
  /** The clock the call's duration is read from; injectable for tests. */
  readonly now?: Clock;
}

/** Wraps a chat model to answer which of a file's findings the diff refutes. */
export class FindingVerifier {
  private readonly log: Logger;
  private readonly systemPrompt: string;
  private readonly now: Clock;

  constructor(
    private readonly model: ChatModel,
    options: FindingVerifierOptions,
  ) {
    this.log = (options.logger ?? NULL_LOGGER).child("review.verify");
    this.systemPrompt = options.systemPrompt;
    this.now = options.now ?? SYSTEM_CLOCK;
  }

  /**
   * Verifies one file's findings. Never throws.
   *
   * @returns The verdict. No findings costs no call; a failed call or unparseable reply keeps everything.
   */
  async verify(input: VerifyInput): Promise<Verdict> {
    const { findings } = input;
    if (findings.length === 0) return keepAll(findings);

    const messages: ChatMessage[] = [
      { role: "system", content: this.systemPrompt, stable: true },
      { role: "user", content: buildVerifyPrompt(input) },
    ];
    let response: ChatResponse;
    const elapsed = stopwatch(this.now);
    try {
      response = await this.model.generate(messages, { responseFormat: "json" });
    } catch (error) {
      return this.failOpen(input, `the call failed (${errorMessage(error)})`);
    }
    const took = elapsed();
    const cost = describeUsage(response.usage, took);
    this.log.debug(
      `${input.path}: the verifier answered in ${seconds(took)} for ${findings.length} finding(s)${cost === "" ? "" : ` (${cost})`}.`,
    );
    let payload: JsonValue;
    try {
      payload = extractJson(response.text);
    } catch (error) {
      return this.failOpen(input, `the reply was not JSON (${errorMessage(error)})`);
    }
    return this.verdictOf(input, removalsFrom(payload, findings.length));
  }

  /** Splits the findings on the removals, logging each. */
  private verdictOf(input: VerifyInput, removals: ReadonlyMap<number, Removal>): Verdict {
    if (removals.size === 0) return keepAll(input.findings);
    const kept: Finding[] = [];
    const refuted: Refutation[] = [];
    for (const [position, finding] of input.findings.entries()) {
      const removal = removals.get(position + 1);
      if (removal === undefined) {
        kept.push(finding);
        continue;
      }
      refuted.push({ finding, ground: removal.ground, reason: removal.reason });
      this.log.info(
        `${input.path}: dropped a ${finding.severity} finding at ${whereOf(finding)} -- ${groundOf(removal)}.`,
      );
    }
    return { kept, refuted };
  }

  /** Keeps everything and says why the question went unanswered. */
  private failOpen(input: VerifyInput, detail: string): Verdict {
    this.log.warn(
      `Could not verify ${input.path}: ${detail}; keeping all ${input.findings.length} finding(s).`,
    );
    return keepAll(input.findings);
  }
}

/** A removal's evidence as the log states it. */
function groundOf(removal: Removal): string {
  const ground = removal.ground === "" ? "no ground given" : `ground ${removal.ground}`;
  return removal.reason === "" ? ground : `${ground}: ${removal.reason}`;
}
