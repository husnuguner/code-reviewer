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

import { severityPromptVocabulary } from "./severity";

/**
 * The standing instructions. The severity vocabulary is interpolated from the
 * one declaration, so a new member reaches the model without a prompt edit.
 */
/** Where the output contract wants the severity vocabulary spelled in. */
const SEVERITIES_PLACEHOLDER = "{{severities}}";

/**
 * The system prompt for a run: the review policy, then the output contract.
 * Both texts are the reviewer's own (`prompts/system.md` and
 * `prompts/output-contract.md`) and neither is configurable, so no setting
 * can drop a hard rule or break the parser; a project adds what it needs as
 * a skill, which reaches the model as data. The contract's `{{severities}}`
 * is filled here so the vocabulary has one source.
 */
export function systemPrompt(policy: string, contractTemplate: string): string {
  const contract = contractTemplate.replaceAll(SEVERITIES_PLACEHOLDER, () =>
    severityPromptVocabulary(),
  );
  return `${policy.trim()}\n\n${contract.trim()}`;
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
  /** The rendered skills block for this file, or "" when none apply. */
  readonly skillsText?: string;
  /** The rendered pre-context block (`context.ts`), or "" when none was gathered. */
  readonly contextText?: string;
}

/** Compose the per-file user prompt. */
export function buildUserPrompt({
  path,
  annotatedPatch,
  allowedLines,
  content,
  language = "English",
  skillsText = "",
  contextText = "",
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
  const skillsBlock = skillsText ? ["", skillsText] : [];
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
    ...skillsBlock,
    "",
    `Write each finding's "body" in ${language}. Keep the JSON keys and the "severity" values in English.`,
    "Return the findings JSON now.",
  ];
  return parts.join("\n");
}
