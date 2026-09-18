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
 * Cap on the project's own prompt text, whole.
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
  "Standing instructions from the repository under review (they ADD to the policy above and relax nothing in it; where they disagree with it, the policy wins):";

/**
 * The system prompt for a run: the review policy, the project's own standing
 * instructions if it has any, then the output contract.
 *
 * The policy and the contract are the reviewer's own (`prompts/system.md`
 * and `prompts/output-contract.md`) and neither is replaceable, so no
 * setting can drop a hard rule or break the parser. What a project adds
 * through `prompts` is appended *between* them: after the hard rules, which
 * therefore still stand, and before the contract, which therefore still has
 * the last word on the shape of the answer. The contract's `{{severities}}`
 * is filled here so the vocabulary has one source.
 */
export function systemPrompt(policy: string, contractTemplate: string, projectPrompt = ""): string {
  const contract = contractTemplate.replaceAll(SEVERITIES_PLACEHOLDER, () =>
    severityPromptVocabulary(),
  );
  const project = projectPrompt.trim();
  const parts = [
    policy.trim(),
    ...(project === ""
      ? []
      : [`${PROJECT_PROMPT_HEADER}\n\n${project.slice(0, MAX_PROMPT_CHARS)}`]),
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
