/**
 * Prompts for the per-file review call. The wording is a behavioural contract (`tests/fixtures/prompts.json`).
 * @packageDocumentation
 */

import { type ChatMessage } from "../ports/chat-model";

import { SEVERITIES, severityPromptVocabulary } from "./severity";

/** Where the output contract wants the severity vocabulary spelled in. */
const SEVERITIES_PLACEHOLDER = "{{severities}}";

/** Cap on the project's standing instructions, all files together. Not a setting: what does not fit belongs in a skill. */
export const MAX_PROMPT_CHARS = 20_000;

/** The header the project's instructions are announced under. */
const PROJECT_PROMPT_HEADER =
  "Standing instructions from the repository under review (they ADD to the policy above and relax nothing in it; where they disagree with it, the policy wins). Each section below names the file it came from:";

/** One file of standing instructions. */
export interface StandingInstruction {
  /** The file as an operator would name it: `prompts/security.md`. */
  readonly label: string;
  readonly text: string;
}

/** One instruction as its own labelled section. */
function section({ label, text }: StandingInstruction): string {
  return `## ${label}\n\n${text.trim()}`;
}

/**
 * Composes the system prompt: policy, the project's standing instructions, output contract.
 *
 * @param policy - `prompts/system.md`.
 * @param contractTemplate - `prompts/output-contract.md`; `{{severities}}` is filled here.
 * @param instructions - The project's `prompts/*.md`, appended between policy and contract, capped at {@link MAX_PROMPT_CHARS}.
 * @returns The prompt. With no instructions it is byte-for-byte the prompt of a project that said nothing.
 */
export function systemPrompt(
  policy: string,
  contractTemplate: string,
  instructions: readonly StandingInstruction[] = [],
): string {
  const contract = contractTemplate.replaceAll(SEVERITIES_PLACEHOLDER, () =>
    severityPromptVocabulary(),
  );
  const sections = instructions
    .filter(({ text }) => text.trim() !== "")
    .map(section)
    .join("\n\n");
  const parts = [
    policy.trim(),
    ...(sections === ""
      ? []
      : [`${PROJECT_PROMPT_HEADER}\n\n${sections.slice(0, MAX_PROMPT_CHARS)}`]),
    contract.trim(),
  ];
  return parts.join("\n\n");
}

/** Sent as one extra turn when the findings payload does not parse. */
export const RETRY_PROMPT = `Your previous reply was not valid JSON. Reply again with ONLY the JSON object described above -- {"findings": [...]} -- and nothing else: no prose, no explanation, no code fences.`;

/** Input to {@link buildUserPrompt}. */
export interface UserPromptInput {
  readonly path: string;
  readonly annotatedPatch: string;
  readonly allowedLines: readonly number[];
  readonly content: string | null;
  /** Language for each finding's `body`; default English. */
  readonly language?: string;
  /** The rendered pre-context block, or `""`. */
  readonly contextText?: string;
  /** The per-file cap, told to the model so it does not generate what the report would cut; `0` asks for no limit. */
  readonly maxFindings?: number;
}

/**
 * The sentence asking the model to stop at the cap, in the reviewer's severity order.
 *
 * @remarks "Do not shorten or merge" is the half that matters: a merged finding cannot be anchored.
 */
export function findingsCapSentence(maxFindings: number): string {
  const order = SEVERITIES.join(", ");
  return (
    `Report at most ${maxFindings} finding(s). If there are more, keep the most severe ` +
    `(in this order: ${order}) and leave the rest out; do not shorten or merge findings to fit.`
  );
}

/**
 * Composes the per-file user prompt: the part of the turn that is this file's alone.
 *
 * @remarks The skills block is not here; it precedes this as its own stable message (see {@link reviewMessages}).
 */
export function buildUserPrompt({
  path,
  annotatedPatch,
  allowedLines,
  content,
  language = "English",
  contextText = "",
  maxFindings = 0,
}: UserPromptInput): string {
  const contextBlock =
    content !== null && content !== ""
      ? [
          "",
          "Full file content at the PR head (for context only; still only comment on allowed added lines):",
          "```",
          content,
          "```",
        ]
      : [];
  const surroundingsBlock = contextText ? ["", contextText] : [];
  const capLine = maxFindings > 0 ? [findingsCapSentence(maxFindings)] : [];
  const parts = [
    `File: ${path}`,
    "",
    "Allowed line numbers (you may ONLY use these in findings):",
    allowedLines.length > 0 ? allowedLines.join(", ") : "(none)",
    "",
    "Unified diff (added lines prefixed with [L<n>]):",
    "```diff",
    annotatedPatch,
    "```",
    ...contextBlock,
    ...surroundingsBlock,
    "",
    `Write each finding's "body" in ${language}. Keep the JSON keys and the "severity" values in English.`,
    ...capLine,
    "Return the findings JSON now.",
  ];
  return parts.join("\n");
}

/**
 * The conversation for one file's review, stable prefix first.
 *
 * @returns The standing prompt and the skills block (both `stable`, the latter absent when empty), then the file.
 * @remarks Stable prefix first lets a vendor with prompt caching pay for it once per run.
 */
export function reviewMessages(
  systemPrompt: string,
  skillsText: string,
  userPrompt: string,
): ChatMessage[] {
  return [
    { role: "system", content: systemPrompt, stable: true },
    ...(skillsText === "" ? [] : [{ role: "user" as const, content: skillsText, stable: true }]),
    { role: "user", content: userPrompt },
  ];
}
