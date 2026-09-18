/**
 * The verification pass: a second model call that removes the findings the
 * diff itself refutes.
 *
 * The reviewer is asked for problems and answers with problems; some of them
 * are about code that is not there. Those cost the author's trust far more
 * than they cost attention, and no amount of prompt tuning removes them all.
 * So a finding faces one more question before it can be posted -- *does this
 * diff prove you wrong?* -- asked of a model that is shown the diff and the
 * findings, and nothing else.
 *
 * The two errors available here are not symmetric, and the design says so at
 * every level. Keeping a wrong finding wastes seconds; removing a right one
 * destroys a real finding silently. So the policy (`prompts/verify.md`)
 * admits exactly two grounds for removal, vetoes the subjects where a wrong
 * removal is most expensive, and answers "keep" whenever the evidence falls
 * short -- and this module **fails open** to match: a failed call, an
 * unparseable reply, an out-of-range index or a malformed entry all leave the
 * finding standing. Nothing here can turn into a silent deletion.
 *
 * The verifier may only *remove*. It never edits a finding's text, its
 * severity or its anchor, so verification cannot introduce a claim the
 * reviewer did not make.
 */

import { type Finding } from "../domain/finding";
import { type ChatMessage, type ChatModel, type ChatResponse } from "../ports/chat-model";
import { type Logger, NULL_LOGGER } from "../ports/logger";
import { errorMessage } from "../util/errors";
import { type JsonValue, hasContent, isInteger, isJsonArray, isJsonObject } from "../util/json";
import { asText, collapseWhitespace } from "../util/text";
import { type Clock, SYSTEM_CLOCK, describeUsage, seconds, stopwatch } from "../util/timing";

import { extractJson } from "./file-reviewer";

/** One file's findings, with the diff they were written from. */
export interface VerifyInput {
  readonly path: string;
  /** The same annotated diff the reviewer saw, as `[L<n>]`-prefixed text. */
  readonly annotatedPatch: string;
  readonly findings: readonly Finding[];
}

/** One removed finding, with the ground the verifier gave for removing it. */
export interface Refutation {
  readonly finding: Finding;
  /** `"A"` (not in the diff), `"B"` (contradicted), or `""` when none was given. */
  readonly ground: string;
  /** The verifier's one-sentence evidence; `""` when it gave none. */
  readonly reason: string;
}

/** What survived verification, and what did not. */
export interface Verdict {
  readonly kept: readonly Finding[];
  readonly refuted: readonly Refutation[];
}

/** The verdict that removes nothing -- the answer to every failure here. */
export function keepAll(findings: readonly Finding[]): Verdict {
  return { kept: [...findings], refuted: [] };
}

/** One entry of the model's `remove` list, validated. */
export interface Removal {
  /** 1-based position in the list the prompt showed. */
  readonly index: number;
  readonly ground: string;
  readonly reason: string;
}

/** The grounds the policy admits; anything else is recorded as none. */
const GROUNDS: ReadonlySet<string> = new Set(["A", "B"]);

/** One line of text with its whitespace collapsed, as the prompt lists it. */
function oneLine(text: string): string {
  return collapseWhitespace(text);
}

/** One removal entry, or `null` when it is not usable. */
function removalFrom(item: JsonValue): Removal | null {
  // A model that answers `{"remove": [2]}` means the same thing as the full
  // entry, minus the evidence; that is a removal without a stated ground.
  if (isInteger(item)) return { index: item, ground: "", reason: "" };
  if (!isJsonObject(item)) return null;
  const index = item["index"];
  if (!isInteger(index)) return null;
  const ground = (hasContent(item["ground"]) ? asText(item["ground"]) : "").trim().toUpperCase();
  const reason = oneLine(hasContent(item["reason"]) ? asText(item["reason"]) : "");
  return { index, ground: GROUNDS.has(ground) ? ground : "", reason };
}

/**
 * The removals a reply asks for, by index, out of `count` findings.
 *
 * Every way an entry can be wrong -- a missing list, a non-integer index, an
 * index naming no finding, a repeat -- drops that entry and keeps the
 * finding. A reply that is entirely malformed therefore removes nothing.
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

/** One finding as the numbered list shows it: what it says and what it quotes. */
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

/** Compose the verification call's user prompt. */
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

/** What the per-file verifier needs from the model-backed implementation. */
export interface FindingVerifierOptions {
  /** The verification policy (`prompts/verify.md`). */
  readonly systemPrompt: string;
  readonly logger?: Logger;
  /** The clock the call's duration is read from; injected so a test can pin it. */
  readonly now?: Clock;
}

/** Wraps the chat model to answer which of a file's findings the diff refutes. */
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

  /** The findings that survive, and the ones the diff refuted. Never throws. */
  async verify(input: VerifyInput): Promise<Verdict> {
    const { findings } = input;
    // Nothing to check is the common case: a clean file costs no second call.
    if (findings.length === 0) return keepAll(findings);

    const messages: ChatMessage[] = [
      // The policy is the same on every verification of the run; the file
      // and its findings are not. Marked so a vendor that keeps prefixes
      // keeps the one worth keeping.
      { role: "system", content: this.systemPrompt, stable: true },
      { role: "user", content: buildVerifyPrompt(input) },
    ];
    let response: ChatResponse;
    const elapsed = stopwatch(this.now);
    try {
      response = await this.model.generate(messages);
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
      // Not retried, unlike the review itself: there a bad reply costs the
      // file's findings, here it costs nothing but a finding the author reads.
      return this.failOpen(input, `the reply was not JSON (${errorMessage(error)})`);
    }
    return this.verdictOf(input, removalsFrom(payload, findings.length));
  }

  /** Split the findings on the removals, recording each removal as it goes. */
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

  /** Keep everything, and say why the question went unanswered. */
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
