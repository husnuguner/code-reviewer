import { describe, expect, it } from "bun:test";

import { addedLines, newSideIndex } from "../../src/core/diff/patch-view";
import { type Finding } from "../../src/core/domain/finding";
import { type ChatMessage, type ChatModel } from "../../src/core/ports/chat-model";
import { FileReviewer, extractJson } from "../../src/core/review/file-reviewer";
import { findingsCapSentence } from "../../src/core/review/prompts";
import { recordingLogger } from "../helpers/logging";

import { type FixtureCase, caseNamed, casesUnder, expectContract, loadFixture } from "./fixtures";

const cases = loadFixture("file_reviewer");

/** Answers with the given texts in order; records every call's messages. */
class FakeModel implements ChatModel {
  readonly calls: ChatMessage[][] = [];

  constructor(private readonly texts: readonly string[]) {}

  generate(messages: readonly ChatMessage[]): Promise<{ text: string }> {
    this.calls.push([...messages]);
    const text = this.texts[Math.min(this.calls.length - 1, this.texts.length - 1)] ?? "";
    return Promise.resolve({ text });
  }
}

class RaisingModel implements ChatModel {
  calls = 0;

  generate(): Promise<{ text: string }> {
    this.calls++;
    return Promise.reject(new Error("boom"));
  }
}

interface ReviewInput {
  patch: string;
  responses: string[];
}

interface ReviewExpectation {
  calls: number;
  last_message_content_has_json_word: boolean | null;
  message_counts: number[];
  findings: Finding[];
}

const PATCH =
  "@@ -1,2 +1,4 @@\n const a = 1;\n+const rows = await repo.find();\n+return rows;\n export {};\n";

async function review(
  model: ChatModel,
  patch: string,
  options: { withIndex?: boolean; allowed?: ReadonlySet<number> } = {},
): Promise<Finding[]> {
  return new FileReviewer(model, { systemPrompt: "system" }).reviewFile({
    path: "a.ts",
    annotatedPatch: "(annotated diff)",
    allowedLines: options.allowed ?? addedLines(patch),
    content: null,
    ...(options.withIndex !== false && { anchorIndex: newSideIndex(patch) }),
  });
}

/** One `review_file/` case; `E` names the expectation's shape where it is not the usual one. */
function reviewCase<E = ReviewExpectation>(name: string): FixtureCase<ReviewInput, E> {
  return caseNamed<ReviewInput, E>(cases, `review_file/${name}`);
}

describe("extracting the findings object from model text", () => {
  it.each(casesUnder<{ text: string }>(cases, "extract_json"))("$name", ({ input, expected }) => {
    expectContract(() => extractJson(input.text), expected);
  });
});

describe("reviewing one file through the model", () => {
  const special = new Set([
    "no_allowed_lines_skips_model",
    "model_error_returns_empty",
    "no_anchor_index_uses_line_only",
  ]);
  const ordinary = casesUnder<ReviewInput, ReviewExpectation>(cases, "review_file").filter(
    (c) => !special.has(c.name),
  );

  it.each(ordinary)("$name", async ({ input, expected }) => {
    const model = new FakeModel(input.responses);
    const findings = await review(model, input.patch);
    expect(findings).toEqual(expected.findings);
    expect(model.calls).toHaveLength(expected.calls);
    expect(model.calls.map((m) => m.length)).toEqual(expected.message_counts);
    const last = model.calls.at(-1)?.at(-1)?.content.toLowerCase() ?? "";
    const hasJsonWord = expected.last_message_content_has_json_word;
    expect(hasJsonWord === null ? null : last.includes("json")).toBe(hasJsonWord);
  });

  it("does not call the model when the file has no commentable lines", async () => {
    const { input, expected } = reviewCase("no_allowed_lines_skips_model");
    const model = new FakeModel(input.responses);
    const findings = await review(model, input.patch, { allowed: new Set() });
    expect(findings).toEqual(expected.findings);
    expect(model.calls).toHaveLength(0);
  });

  it("returns no findings, after one call, when the model itself fails", async () => {
    const { expected } = reviewCase("model_error_returns_empty");
    const model = new RaisingModel();
    const findings = await review(model, PATCH);
    expect(findings).toEqual(expected.findings);
    expect(model.calls).toBe(1);
  });

  it("falls back to the model's line alone when no anchor index is given", async () => {
    const { input, expected } = reviewCase<Finding[]>("no_anchor_index_uses_line_only");
    const findings = await review(new FakeModel(input.responses), input.patch, {
      withIndex: false,
    });
    expect(findings).toEqual(expected);
  });

  it("takes a float line JSON.parse reads as an integer as the claimed line", async () => {
    // `"line": 2.0` parses to the integer 2, which is commentable, so the
    // claimed line stands -- and the quote, which points at line 3, is
    // recorded as a conflict rather than allowed to move the comment.
    const { input } = reviewCase("float_line_parses_as_an_integer");
    const findings = await review(new FakeModel(input.responses), input.patch);
    expect(findings[0]).toMatchObject({ line: 2, anchor: "conflict", body: "x" });
  });

  it("asks the model to stop at the run's cap, and asks nothing of the kind without one", async () => {
    const capped = new FakeModel(['{"findings": []}']);
    await new FileReviewer(capped, { systemPrompt: "system" }).reviewFile({
      path: "a.ts",
      annotatedPatch: "(annotated diff)",
      allowedLines: addedLines(PATCH),
      content: null,
      maxFindings: 3,
    });
    expect(capped.calls[0]?.at(-1)?.content).toContain(findingsCapSentence(3));

    const uncapped = new FakeModel(['{"findings": []}']);
    await review(uncapped, PATCH);
    expect(uncapped.calls[0]?.at(-1)?.content).not.toContain("Report at most");
  });

  it("sends a real system message followed by the user prompt", async () => {
    const model = new FakeModel(['{"findings": []}']);
    await review(model, PATCH);
    expect(model.calls[0]?.map((m) => m.role)).toEqual(["system", "user"]);
  });

  it("marks the standing prompt and the skills as stable, the file itself not", async () => {
    // What a vendor may keep across calls: the policy on every call, the
    // skills on every file with the same skills. The file's own text is new
    // each time and must not be marked, or a vendor would keep it for nobody.
    const model = new FakeModel(['{"findings": []}']);
    await new FileReviewer(model, { systemPrompt: "system" }).reviewFile({
      path: "a.ts",
      annotatedPatch: "(annotated diff)",
      allowedLines: addedLines(PATCH),
      content: null,
      skillsText: "## http-route\nrules",
    });
    const sent = model.calls[0] ?? [];
    expect(sent.map((m) => [m.role, m.stable ?? false])).toEqual([
      ["system", true],
      ["user", true],
      ["user", false],
    ]);
    expect(sent[1]?.content).toBe("## http-route\nrules");
    // The file's text carries no skills of its own any more: they went ahead.
    expect(sent[2]?.content).not.toContain("http-route");
    expect(sent[2]?.content).toContain("File: a.ts");
  });

  it("says how long each attempt waited on the model", async () => {
    // Two attempts -- the first answer is not JSON -- each timed on its own,
    // so a file paid for twice reads as two waits rather than one long one.
    const lines: string[] = [];
    let now = 0;
    const reviewer = new FileReviewer(new FakeModel(["not json", '{"findings": []}']), {
      systemPrompt: "system",
      logger: recordingLogger(lines),
      now: () => (now += 30_000),
    });
    await reviewer.reviewFile({
      path: "a.ts",
      annotatedPatch: "(annotated diff)",
      allowedLines: addedLines(PATCH),
      content: null,
    });
    expect(lines.filter((line) => line.includes("the model answered"))).toEqual([
      "DEBUG a.ts: the model answered in 30.0s (attempt 1 of 2).",
      "DEBUG a.ts: the model answered in 30.0s (attempt 2 of 2).",
    ]);
  });

  it("says what a call cost when the model reports its token counts", async () => {
    // The rate is the diagnosis: 2,410 tokens in 77.7s is a long answer at a
    // normal speed, which is the reviewer's own doing and fixable by asking
    // for less. The line has to make that arithmetic visible.
    const lines: string[] = [];
    let now = 0;
    const counting: ChatModel = {
      generate: () =>
        Promise.resolve({
          text: '{"findings": []}',
          usage: { inputTokens: 7036, outputTokens: 2410 },
        }),
    };
    const reviewer = new FileReviewer(counting, {
      systemPrompt: "system",
      logger: recordingLogger(lines),
      now: () => (now += 77_700),
    });
    await reviewer.reviewFile({
      path: "a.ts",
      annotatedPatch: "(annotated diff)",
      allowedLines: addedLines(PATCH),
      content: null,
    });
    expect(lines).toEqual([
      "DEBUG a.ts: the model answered in 77.7s (attempt 1 of 2; 7,036 tokens in, 2,410 out, 31 tokens/s).",
    ]);
  });

  it("says how long a failed call waited before it failed", async () => {
    const lines: string[] = [];
    let now = 0;
    const reviewer = new FileReviewer(new RaisingModel(), {
      systemPrompt: "system",
      logger: recordingLogger(lines),
      now: () => (now += 180_000),
    });
    await reviewer.reviewFile({
      path: "a.ts",
      annotatedPatch: "(annotated diff)",
      allowedLines: addedLines(PATCH),
      content: null,
    });
    expect(lines).toEqual(["WARNING LLM call failed for a.ts after 180.0s: boom"]);
  });
});
