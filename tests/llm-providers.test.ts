/**
 * The LLM port over the AI SDK: one adapter, several vendors, no network.
 *
 * `@ai-sdk/provider` is the SDK's own type package (a declared devDependency);
 * it names the shape a mock model must answer with.
 */

import { type LanguageModelV3GenerateResult } from "@ai-sdk/provider";
import { MockLanguageModelV3 } from "ai/test";
import { describe, expect, it } from "vitest";

import { LLMProviderRegistry, type ProviderSettings } from "../src/core/llm/provider-registry";
import { ValueError } from "../src/core/util/errors";
import { AiSdkChatModel, splitSystem } from "../src/infra/llm/ai-sdk-chat-model";
import { BUILTIN_LLM_PROVIDERS, builtinLLMProviderRegistry } from "../src/infra/llm/index";

const TOKENS = { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined };

function mockModel(text: string): MockLanguageModelV3 {
  const result: LanguageModelV3GenerateResult = {
    content: [
      { type: "reasoning", text: "thinking..." },
      { type: "text", text },
    ],
    finishReason: { unified: "stop", raw: "stop" },
    usage: { inputTokens: TOKENS, outputTokens: { ...TOKENS, text: 1, reasoning: 0 } },
    warnings: [],
  };
  return new MockLanguageModelV3({ doGenerate: () => Promise.resolve(result) });
}

const settings = (provider: string, modelName: string | null = null): ProviderSettings => ({
  provider,
  apiKey: "key",
  baseUrl: null,
  modelName,
});

describe("AI SDK chat model adapter", () => {
  it("returns the assistant text and drops reasoning blocks", async () => {
    const model = mockModel('{"findings": []}');
    const response = await new AiSdkChatModel(model).generate([
      { role: "system", content: "SYS" },
      { role: "user", content: "USER" },
    ]);
    expect(response.text).toBe('{"findings": []}');
  });

  it("sends the system prompt as instructions and the rest as messages", async () => {
    const model = mockModel("ok");
    await new AiSdkChatModel(model).generate([
      { role: "system", content: "SYS" },
      { role: "user", content: "USER" },
      { role: "user", content: "RETRY" },
    ]);
    const prompt = model.doGenerateCalls[0]?.prompt ?? [];
    expect(prompt.map((m) => m.role)).toEqual(["system", "user", "user"]);
    expect(prompt[0]?.content).toBe("SYS");
  });

  it("joins several system messages and keeps the conversation order", () => {
    const { instructions, conversation } = splitSystem([
      { role: "system", content: "A" },
      { role: "user", content: "u1" },
      { role: "system", content: "B" },
      { role: "assistant", content: "a1" },
    ]);
    expect(instructions).toBe("A\n\nB");
    expect(conversation).toEqual([
      { role: "user", content: "u1" },
      { role: "assistant", content: "a1" },
    ]);
  });

  it("has no instructions when no system message was given", () => {
    expect(splitSystem([{ role: "user", content: "u" }]).instructions).toBeUndefined();
  });
});

describe("LLM provider registry", () => {
  it("knows the built-in providers by name, sorted", () => {
    expect(builtinLLMProviderRegistry().names()).toEqual(["claude", "local"]);
    expect(BUILTIN_LLM_PROVIDERS.map((p) => p.defaultModel)).toEqual([
      "gpt-4.1",
      "claude-sonnet-4-6",
    ]);
  });

  it("builds a chat model for each built-in provider", () => {
    const registry = builtinLLMProviderRegistry();
    expect(registry.build(settings("local"))).toBeInstanceOf(AiSdkChatModel);
    expect(registry.build(settings("claude", "claude-opus-4-8"))).toBeInstanceOf(AiSdkChatModel);
  });

  it("refuses an unknown provider by name, listing the known ones", () => {
    expect(() => builtinLLMProviderRegistry().build(settings("gemini"))).toThrow(ValueError);
    expect(() => builtinLLMProviderRegistry().build(settings("gemini"))).toThrow(
      "Unknown LLM provider 'gemini'; available: ['claude', 'local']",
    );
  });

  it("applies the model override, else the provider default", () => {
    const seen: string[] = [];
    const registry = new LLMProviderRegistry([
      {
        name: "fake",
        defaultModel: "fake-default",
        build: (_settings, model) => {
          seen.push(model);
          return new AiSdkChatModel(mockModel(""));
        },
      },
    ]);
    registry.build(settings("fake"));
    registry.build(settings("fake", "fake-large"));
    expect(seen).toEqual(["fake-default", "fake-large"]);
  });
});
