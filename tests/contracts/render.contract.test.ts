import { describe, expect, it } from "vitest";

import { RETRY_PROMPT, buildUserPrompt, systemPrompt } from "../../src/core/review/prompts";
import { textBody } from "../../src/core/review/render";
import { pySorted } from "../../src/core/util/py";
import { shippedFile } from "../../src/infra/shipped-files";

import { casesUnder, loadFixture } from "./fixtures";

const render = loadFixture("render");
const prompts = loadFixture("prompts");

describe("rendering findings", () => {
  it.each(casesUnder<{ severity: string; body: string }, string>(render, "text_body"))(
    "text_body %s",
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
  return pySorted(
    text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "" && !/^(Rules|Review rules|Output rules):$/u.test(line)),
  );
}

describe("prompts", () => {
  // The shipped policy + contract say everything the Python prompt said, in
  // a different order -- policy first, the JSON contract last -- plus the
  // sentences this implementation added (documented divergence; the fixture
  // keeps the Python text). Nothing of the reference may go missing.
  it("keeps every sentence of the reference system prompt, regrouped", () => {
    const reference = prompts.find((c) => c.name === "system_prompt");
    expect(reference?.divergence).toBeDefined();
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

  it("keeps the retry prompt verbatim", () => {
    expect(RETRY_PROMPT).toBe(prompts.find((c) => c.name === "retry_prompt")?.expected);
  });

  it.each(casesUnder<PromptInput, string>(prompts, "build_user_prompt"))(
    "build_user_prompt %s",
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
