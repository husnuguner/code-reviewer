import { describe, expect, it } from "bun:test";

import {
  MAX_PROMPT_CHARS,
  RETRY_PROMPT,
  buildUserPrompt,
  findingsCapSentence,
  reviewMessages,
  systemPrompt,
} from "../../src/core/review/prompts";
import { textBody } from "../../src/core/review/render";
import { SEVERITIES } from "../../src/core/review/severity";
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
  /** The run's per-file cap, told to the model; absent or 0 asks for no limit. */
  max_findings?: number;
  /** Whether the diff carries a `[bypassed \u2026]` line; absent reads as no. */
  has_bypassed_lines?: boolean;
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
    const composed = systemPrompt("Be kind.", "Answer as JSON.", [
      { label: "prompts/prompts.md", text: "  Our IDs are ULIDs.  " },
    ]);
    // The hard rules keep their place above it, and the contract keeps the
    // last word on the shape of the answer: a project adds, it cannot
    // rearrange.
    expect(composed.indexOf("Be kind.")).toBeLessThan(composed.indexOf("Our IDs are ULIDs."));
    expect(composed.indexOf("Our IDs are ULIDs.")).toBeLessThan(
      composed.indexOf("Answer as JSON."),
    );
    expect(composed).toContain("ADD to the policy above");
  });

  it("gives each file its own heading, so a rule can be traced to the file it is in", () => {
    // The directory may hold several files; the model is told which is which
    // rather than one anonymous block, and they keep the order they were read.
    const composed = systemPrompt("Be kind.", "Answer as JSON.", [
      { label: "prompts/prompts.md", text: "Our IDs are ULIDs." },
      { label: "prompts/security.md", text: "Never log a token." },
    ]);
    expect(composed).toContain("## prompts/prompts.md\n\nOur IDs are ULIDs.");
    expect(composed).toContain("## prompts/security.md\n\nNever log a token.");
    expect(composed.indexOf("## prompts/prompts.md")).toBeLessThan(
      composed.indexOf("## prompts/security.md"),
    );
  });

  it("says nothing extra when the project's prompt file is empty", () => {
    // The ordinary case, and the one `reviewer init` leaves behind: an empty
    // file must compose exactly the prompt of a repository that said nothing
    // -- no heading for it either.
    expect(
      systemPrompt("Be kind.", "Answer as JSON.", [
        { label: "prompts/prompts.md", text: " ".repeat(3) },
      ]),
    ).toBe(systemPrompt("Be kind.", "Answer as JSON."));
  });

  it("cuts a standing instruction that would be paid for on every file", () => {
    const label = "prompts/huge.md";
    const heading = `## ${label}\n\n`;
    const huge = "x".repeat(MAX_PROMPT_CHARS + 500);
    const composed = systemPrompt("Be kind.", "Answer as JSON.", [{ label, text: huge }]);
    // The cap covers the whole block, headings included: what is paid for on
    // every file is everything between the policy and the contract.
    expect(composed).toContain("x".repeat(MAX_PROMPT_CHARS - heading.length));
    expect(composed).not.toContain("x".repeat(MAX_PROMPT_CHARS - heading.length + 1));
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
          ...(input.max_findings !== undefined && { maxFindings: input.max_findings }),
          ...(input.has_bypassed_lines !== undefined && {
            hasBypassedLines: input.has_bypassed_lines,
          }),
        }),
      ).toBe(expected);
    },
  );

  it("puts the stable prefix first: standing prompt, then skills, then the file", () => {
    // The order is what lets a vendor keep the reused part: a prefix has to
    // come before the text that differs. The skills are their own message
    // for the same reason -- two files with the same skills share it.
    const messages = reviewMessages("POLICY", "## skills", "File: a.ts");
    expect(messages).toEqual([
      { role: "system", content: "POLICY", stable: true },
      { role: "user", content: "## skills", stable: true },
      { role: "user", content: "File: a.ts" },
    ]);
    // No skills, no skills message: an empty stable block would be a cache
    // boundary around nothing.
    expect(reviewMessages("POLICY", "", "File: a.ts")).toEqual([
      { role: "system", content: "POLICY", stable: true },
      { role: "user", content: "File: a.ts" },
    ]);
  });

  it("spells the cap's severity order from the one declaration", () => {
    // The model is asked to cut what `capPerFile` would have cut, so the
    // order it is given must be the order the volume policy sorts by.
    expect(findingsCapSentence(3)).toContain(`in this order: ${SEVERITIES.join(", ")}`);
  });
});
