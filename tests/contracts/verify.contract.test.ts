/**
 * The verification pass, whose whole design is that it fails open: every way
 * the second call can go wrong must leave the findings standing. The cases
 * below are mostly that -- one happy path, and then each failure in turn.
 */

import { describe, expect, it } from "bun:test";

import { type Finding, finding } from "../../src/core/domain/finding";
import { type ChatMessage, type ChatModel } from "../../src/core/ports/chat-model";
import {
  FindingVerifier,
  type Removal,
  buildVerifyPrompt,
  removalsFrom,
} from "../../src/core/review/verify";
import { type JsonValue } from "../../src/core/util/json";
import { recordingLogger } from "../helpers/logging";

import { casesUnder, loadFixture } from "./fixtures";

const cases = loadFixture("verify");

const PATCH = "@@ -1 +1,3 @@\n old\n[L2] +const rows = await repo.find();\n[L3] +return rows;";

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

const FINDINGS: [Finding, Finding] = [
  finding({ line: 2, severity: "bug", body: "one", existing_code: "const rows = 1;" }),
  finding({ line: 3, severity: "security", body: "two" }),
];

function verifier(model: ChatModel, lines: string[] = []): FindingVerifier {
  return new FindingVerifier(model, {
    systemPrompt: "verification policy",
    logger: recordingLogger(lines),
  });
}

function verify(
  model: ChatModel,
  findings: readonly Finding[] = FINDINGS,
  lines: string[] = [],
): ReturnType<FindingVerifier["verify"]> {
  return verifier(model, lines).verify({ path: "a.ts", annotatedPatch: PATCH, findings });
}

describe("the prompt the verifier sends", () => {
  interface PromptInput {
    path: string;
    annotated_patch: string;
    findings: Finding[];
  }

  it.each(casesUnder<PromptInput, string>(cases, "build_prompt"))(
    "$name",
    ({ input, expected }) => {
      const prompt = buildVerifyPrompt({
        path: input.path,
        annotatedPatch: input.annotated_patch,
        findings: input.findings,
      });
      expect(prompt).toBe(expected);
    },
  );
});

describe("reading the removals out of a reply", () => {
  interface RemovalInput {
    payload: JsonValue;
    count: number;
  }

  it.each(casesUnder<RemovalInput, Record<string, Removal>>(cases, "removals"))(
    "$name",
    ({ input, expected }) => {
      expect(Object.fromEntries(removalsFrom(input.payload, input.count))).toEqual(expected);
    },
  );
});

describe("verifying one file's findings", () => {
  it("removes the finding the reply names and keeps the rest", async () => {
    const reply = '{"remove": [{"index": 1, "ground": "B", "reason": "line 2 uses it"}]}';
    const verdict = await verify(new FakeModel([reply]));
    expect(verdict.kept.map((f) => f.body)).toEqual(["two"]);
    expect(verdict.refuted).toEqual([
      { finding: FINDINGS[0], ground: "B", reason: "line 2 uses it" },
    ]);
  });

  it("keeps every finding when the reply removes nothing", async () => {
    const verdict = await verify(new FakeModel(['{"remove": []}']));
    expect(verdict.kept).toEqual(FINDINGS);
    expect(verdict.refuted).toEqual([]);
  });

  it("sends the policy as a system message, then the findings", async () => {
    const model = new FakeModel(['{"remove": []}']);
    await verify(model);
    expect(model.calls[0]?.map((m) => m.role)).toEqual(["system", "user"]);
    expect(model.calls[0]?.[0]?.content).toBe("verification policy");
    expect(model.calls[0]?.[1]?.content).toContain("1. [bug] line 2");
  });

  it("does not call the model when the file produced no findings", async () => {
    const model = new FakeModel(['{"remove": [1]}']);
    const verdict = await verify(model, []);
    expect(model.calls).toHaveLength(0);
    expect(verdict).toEqual({ kept: [], refuted: [] });
  });

  // -- failing open --------------------------------------------------------

  it("keeps every finding when the call fails, and says so once", async () => {
    const lines: string[] = [];
    const model = new RaisingModel();
    const verdict = await verify(model, FINDINGS, lines);
    expect(verdict.kept).toEqual(FINDINGS);
    expect(model.calls).toBe(1);
    expect(lines).toEqual([
      "WARNING Could not verify a.ts: the call failed (boom); keeping all 2 finding(s).",
    ]);
  });

  it("keeps every finding when the reply is not JSON, without retrying", async () => {
    const lines: string[] = [];
    const model = new FakeModel(["I could not decide."]);
    const verdict = await verify(model, FINDINGS, lines);
    expect(verdict.kept).toEqual(FINDINGS);
    // One call only: a finding the author reads is cheaper than a second call.
    expect(model.calls).toHaveLength(1);
    expect(lines[0]).toMatch(/^WARNING Could not verify a\.ts: the reply was not JSON/u);
  });

  it.each(['{"remove": [{"index": 9}]}', '{"remove": "all"}', '{"ok": true}'])(
    "keeps every finding when the reply is JSON that removes nothing usable: %s",
    async (reply) => {
      const verdict = await verify(new FakeModel([reply]));
      expect(verdict.kept).toEqual(FINDINGS);
    },
  );

  it("records each removal with the ground and reason the model gave", async () => {
    const lines: string[] = [];
    const reply = '{"remove": [{"index": 2, "ground": "A", "reason": "no such call in the diff"}]}';
    await verify(new FakeModel([reply]), FINDINGS, lines);
    expect(lines).toEqual([
      "INFO a.ts: dropped a security finding at line 3 -- ground A: no such call in the diff.",
    ]);
  });

  it("records a removal that came with no ground as exactly that", async () => {
    const lines: string[] = [];
    await verify(new FakeModel(['{"remove": [2]}']), FINDINGS, lines);
    expect(lines).toEqual(["INFO a.ts: dropped a security finding at line 3 -- no ground given."]);
  });
});
