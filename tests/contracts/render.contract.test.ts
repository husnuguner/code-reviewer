import { describe, expect, it } from "bun:test";

import {
  MAX_PROMPT_CHARS,
  RETRY_PROMPT,
  buildUserPrompt,
  systemPrompt,
} from "../../src/core/review/prompts";
import { textBody } from "../../src/core/review/render";
import { sortedByCodePoint } from "../../src/core/util/text";
import { shippedFile } from "../../src/providers/assets/shipped-files";

import { caseNamed, casesUnder, loadFixture } from "./fixtures";

const render = loadFixture("render");
const prompts = loadFixture("prompts");

describe("rendering findings", () => {
  it.each(casesUnder<{ severity: string; body: string }, string>(render, "text_body"))(
    "text_body $name",
    ({ input, expected }) => {
      expect(textBody(input.severity, input.body)).toBe(expected);
    },
  );
});

interface PromptInput {
  path: string;
  annotated_patch: string;
  allowed_lines: number[];
  content: string | null;
  language?: string;
  /** The matching skills' text, which is the whole point of the skills pipeline. */
  skills_text?: string;
}

/** A prompt's non-empty lines, section headers dropped, in code-point order. */
function sentences(text: string): string[] {
  return sortedByCodePoint(
    text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "" && !/^(Rules|Review rules|Output rules):$/u.test(line)),
  );
}

describe("prompts", () => {
  // A baseline of instructions the system prompt must still give. The text
  // is held in the fixture and the shipped prompt is free to reorder it,
  // reword around it and add to it -- what this refuses is an instruction
  // quietly disappearing when `prompts/*.md` is edited, which is invisible
  // in review and only shows up as worse findings.
  it("still gives every instruction of the baseline prompt, regrouped", () => {
    const reference = prompts.find((c) => c.name === "system_prompt");
    expect(reference?.expected).toBeDefined();
    const shipped = systemPrompt(
      shippedFile("prompts/system.md"),
      shippedFile("prompts/output-contract.md"),
    );
    const shippedSentences = new Set(sentences(shipped));
    const referenceSentences = sentences(String(reference?.expected));
    for (const sentence of referenceSentences) {
      // The one reference sentence this implementation extended (pre-context).
      const isExtended = sentence.startsWith("Input format:");
      expect(
        isExtended
          ? [...shippedSentences].some((s) => s.startsWith(sentence))
          : shippedSentences.has(sentence),
      ).toBe(true);
    }
    expect(shipped.endsWith('- Keep the JSON keys and the "severity" values in English.')).toBe(
      true,
    );
  });

  it("fills the severity vocabulary into the contract and keeps the policy first", () => {
    const composed = systemPrompt("  Be kind.  ", "Answer as JSON with severity {{severities}}.");
    expect(composed).toBe(
      "Be kind.\n\nAnswer as JSON with severity bug|security|performance|readability.",
    );
  });

  it("appends the project's standing instructions between the policy and the contract", () => {
    const composed = systemPrompt("Be kind.", "Answer as JSON.", "  Our IDs are ULIDs.  ");
    // The hard rules keep their place above it, and the contract keeps the
    // last word on the shape of the answer: a project adds, it cannot
    // rearrange.
    expect(composed.indexOf("Be kind.")).toBeLessThan(composed.indexOf("Our IDs are ULIDs."));
    expect(composed.indexOf("Our IDs are ULIDs.")).toBeLessThan(
      composed.indexOf("Answer as JSON."),
    );
    expect(composed).toContain("ADD to the policy above");
  });

  it("says nothing extra when the project's prompt file is empty", () => {
    // The ordinary case, and the one `reviewer init` leaves behind: an empty
    // file must compose exactly the prompt of a project that named none.
    expect(systemPrompt("Be kind.", "Answer as JSON.", " ".repeat(3))).toBe(
      systemPrompt("Be kind.", "Answer as JSON."),
    );
  });

  it("cuts a standing instruction that would be paid for on every file", () => {
    const huge = "x".repeat(MAX_PROMPT_CHARS + 500);
    const composed = systemPrompt("Be kind.", "Answer as JSON.", huge);
    expect(composed).toContain("x".repeat(MAX_PROMPT_CHARS));
    expect(composed).not.toContain("x".repeat(MAX_PROMPT_CHARS + 1));
  });

  it("keeps the retry prompt verbatim", () => {
    expect(RETRY_PROMPT).toBe(caseNamed<unknown, string>(prompts, "retry_prompt").expected);
  });

  it.each(casesUnder<PromptInput, string>(prompts, "build_user_prompt"))(
    "build_user_prompt $name",
    ({ input, expected }) => {
      expect(
        buildUserPrompt({
          path: input.path,
          annotatedPatch: input.annotated_patch,
          allowedLines: input.allowed_lines,
          content: input.content,
          ...(input.language !== undefined && { language: input.language }),
          ...(input.skills_text !== undefined && { skillsText: input.skills_text }),
        }),
      ).toBe(expected);
    },
  );
});
