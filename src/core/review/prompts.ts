/**
 * Prompts for the per-file reviewer model call.
 *
 * The model's only job: given one file's annotated diff, return a JSON object
 * of findings, each anchored to an ADDED line number that appears in the diff.
 * The driver validates and reports; the model never calls tools.
 *
 * The prompt text is a behavioural contract (frozen in
 * `tests/fixtures/prompts.json`): a wording change alters what the model
 * returns, so it is a deliberate edit, not a tidy-up.
 */

import { type ChatMessage } from "../ports/chat-model";

import { SEVERITIES, severityPromptVocabulary } from "./severity";

/**
 * The standing instructions. The severity vocabulary is interpolated from the
 * one declaration, so a new member reaches the model without a prompt edit.
 */
/** Where the output contract wants the severity vocabulary spelled in. */
const SEVERITIES_PLACEHOLDER = "{{severities}}";

/**
 * Cap on the project's own prompt text, whole -- every file of the `prompts/`
 * directory together, headings included.
 *
 * A standing instruction is paid for on every file of every run, so an
 * unbounded one is a bill nobody meant to sign. This is a constant rather
 * than a setting because the answer to "my standing instructions do not fit
 * in 20k characters" is a skill scoped to the paths it concerns, not a
 * bigger cap.
 */
export const MAX_PROMPT_CHARS = 20_000;

/** The header the project's own instructions are announced under. */
const PROJECT_PROMPT_HEADER =
  "Standing instructions from the repository under review (they ADD to the policy above and relax nothing in it; where they disagree with it, the policy wins). Each section below names the file it came from:";

/**
 * One file of standing instructions: where it came from, and what it says.
 *
 * The label travels with the text because a reader of the prompt -- the
 * model, and whoever is debugging what the model was told -- should be able
 * to see which file an instruction came from. Reading the files is the
 * providers layer's; this module only composes what it is handed.
 */
export interface StandingInstruction {
  /** The file, as an operator would name it: `prompts/security.md`. */
  readonly label: string;
  readonly text: string;
}

/** One instruction as its own labelled section of the prompt. */
function section({ label, text }: StandingInstruction): string {
  return `## ${label}\n\n${text.trim()}`;
}

/**
 * The system prompt for a run: the review policy, the project's own standing
 * instructions if it has any, then the output contract.
 *
 * The policy and the contract are the reviewer's own (`prompts/system.md`
 * and `prompts/output-contract.md`) and neither is replaceable, so no
 * setting can drop a hard rule or break the parser. What a project puts in
 * its `prompts/` directory is appended *between* them: after the hard rules,
 * which therefore still stand, and before the contract, which therefore
 * still has the last word on the shape of the answer. Each file keeps its
 * own heading, so an instruction can be traced back to the file it is in
 * rather than dissolving into one anonymous block. The contract's
 * `{{severities}}` is filled here so the vocabulary has one source.
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

/**
 * Sent as one extra turn when the model's findings payload will not parse. The
 * whole file is otherwise lost, so one cheap retry beats dropping its findings.
 */
export const RETRY_PROMPT = `Your previous reply was not valid JSON. Reply again with ONLY the JSON object described above -- {"findings": [...]} -- and nothing else: no prose, no explanation, no code fences.`;

export interface UserPromptInput {
  readonly path: string;
  readonly annotatedPatch: string;
  readonly allowedLines: readonly number[];
  readonly content: string | null;
  /** Human language for each finding's `body` (default English). */
  readonly language?: string;
  /** The rendered pre-context block (`context.ts`), or "" when none was gathered. */
  readonly contextText?: string;
  /**
   * How many findings the run will report for this file; `0` (the default)
   * asks for no limit.
   *
   * Told to the model rather than only applied afterwards (`volume.ts`),
   * because a completion's wall time is its output: a file with a dozen
   * problems and a cap of three would otherwise pay for twelve findings'
   * worth of generation and throw nine away. The cap after the call still
   * stands -- the model is asked, not trusted -- so `capped` in the summary
   * says how often the request was not honoured.
   */
  readonly maxFindings?: number;
}

/**
 * The sentence that asks the model to stop at the cap.
 *
 * The order is the reviewer's own (`severity.ts`), spelled out so the model
 * cuts the same findings the volume policy would have: the mildest go first.
 * "Do not shorten" is the half that matters -- a model told "at most three"
 * will otherwise fit six into three by merging them, which is a finding
 * nobody can anchor.
 */
export function findingsCapSentence(maxFindings: number): string {
  const order = SEVERITIES.join(", ");
  return (
    `Report at most ${maxFindings} finding(s). If there are more, keep the most severe ` +
    `(in this order: ${order}) and leave the rest out; do not shorten or merge findings to fit.`
  );
}

/**
 * Compose the per-file user prompt: the part of the turn that is this
 * file's alone.
 *
 * The skills block is *not* in here, and used to be. It goes ahead of this
 * text as its own message (`reviewMessages`), because it is the one part of
 * the turn that the next file with the same skills sends again unchanged --
 * and a prefix a vendor can keep has to come before the text that differs,
 * not after it.
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
 * The whole conversation for one file's review, stable prefix first.
 *
 * Three messages at most, in an order that is the point of the function:
 *
 * 1. The standing prompt -- the same on every call of the run.
 * 2. The skills block -- the same on every file that matches the same
 *    skills; absent when none do.
 * 3. The file: its diff, its context, the question.
 *
 * The first two are marked `stable`, so a vendor that keeps prefixes keeps
 * them: a twenty-file pull request then pays for the standing prompt once and
 * for each distinct skills block once, instead of twenty times each. What
 * the model reads is unchanged -- the same text in the same turn -- only the
 * order within the turn has moved the reused part in front of the new part.
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
