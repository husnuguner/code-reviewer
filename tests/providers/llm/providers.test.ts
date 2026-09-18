/**
 * The LLM port over the AI SDK: one adapter, several vendors, no network.
 *
 * `@ai-sdk/provider` is the SDK's own type package (a declared devDependency);
 * it names the shape a mock model must answer with.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { type LanguageModelV3GenerateResult } from "@ai-sdk/provider";
import { APICallError } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { parse as parseYaml } from "yaml";

import { parseCatalog } from "../../../src/core/catalog/parse";
import { resolveConfig } from "../../../src/core/config/resolver";
import { type LlmSettings } from "../../../src/core/config/settings";
import { ValueError } from "../../../src/core/util/errors";
import { AiSdkChatModel, splitSystem } from "../../../src/providers/llm/ai-sdk-chat-model";
import { AiSdkProvider } from "../../../src/providers/llm/ai-sdk-provider";
import { BUILTIN_MODEL_PROVIDERS, builtinModelProviders } from "../../../src/providers/llm/builtin";
import {
  ModelProviderRegistry,
  type ModelRequest,
} from "../../../src/providers/llm/model-provider";

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

const choice = (model: string | null = null): LlmSettings => ({
  apiKey: "key",
  baseUrl: null,
  model,
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

  it("calls the vendor exactly once, leaving trying again to the decorator", async () => {
    // The load-bearing assertion behind `maxRetries: 0`. The SDK retries
    // twice by default and offers no hook to observe it, so leaving it on
    // would turn `RetryingChatModel`'s three attempts into nine calls --
    // silently, and billed.
    const failure = new APICallError({
      message: "upstream is busy",
      url: "https://api.example.com/v1/chat",
      requestBodyValues: {},
      statusCode: 503,
      isRetryable: true,
    });
    const model = new MockLanguageModelV3({ doGenerate: () => Promise.reject(failure) });
    await expect(new AiSdkChatModel(model).generate([{ role: "user", content: "u" }])).rejects.toBe(
      failure,
    );
    expect(model.doGenerateCalls).toHaveLength(1);
  });

  it("passes a caller's signal down, so a deadline can reach the vendor", async () => {
    const controller = new AbortController();
    const model = mockModel("ok");
    await new AiSdkChatModel(model).generate([{ role: "user", content: "u" }], {
      signal: controller.signal,
    });
    expect(model.doGenerateCalls[0]?.abortSignal).toBe(controller.signal);
  });
});

describe("the model provider registry", () => {
  it("knows the built-in providers by name, the default first", () => {
    // Registration order, whose first is the `LLM_PROVIDER` default; sorted is
    // what an error message lists.
    expect(builtinModelProviders().names()).toEqual(["local", "claude"]);
    expect(builtinModelProviders().sortedNames()).toEqual(["claude", "local"]);
    expect(BUILTIN_MODEL_PROVIDERS.map((p) => p.defaultModel)).toEqual([
      "gpt-4.1",
      "claude-sonnet-4-6",
    ]);
  });

  it("describes every provider it accepts, so a refusal and the docs cannot drift from it", () => {
    const described = builtinModelProviders().describe();
    for (const name of builtinModelProviders().names()) expect(described).toContain(`'${name}'`);
  });

  it("builds a chat model for each built-in provider", () => {
    const registry = builtinModelProviders();
    expect(registry.create("local", choice())).toBeInstanceOf(AiSdkChatModel);
    expect(registry.create("claude", choice("claude-opus-4-8"))).toBeInstanceOf(AiSdkChatModel);
  });

  it("refuses an unknown provider by name, listing the known ones", () => {
    expect(() => builtinModelProviders().create("gemini", choice())).toThrow(ValueError);
    expect(() => builtinModelProviders().create("gemini", choice())).toThrow(
      "Unknown LLM provider 'gemini'; available: ['claude', 'local']",
    );
  });

  it("takes the configuration's model, else the provider's default", () => {
    // A vendor that remembers which model it was asked for.
    const seen: string[] = [];
    class FakeProvider extends AiSdkProvider {
      readonly name = "fake";
      readonly description = "a vendor that remembers what it was asked for";
      readonly defaultModel = "fake-default";

      protected languageModel({ model }: ModelRequest): MockLanguageModelV3 {
        seen.push(model);
        return mockModel("");
      }
    }
    const registry = new ModelProviderRegistry([new FakeProvider()]);
    registry.create("fake", choice());
    registry.create("fake", choice("fake-large"));
    expect(seen).toEqual(["fake-default", "fake-large"]);
  });

  it("is what the configuration validates against and defaults to, not a list of its own", () => {
    // The registry's two facts, handed over as the composition root hands
    // them: an unset `LLM_PROVIDER` means the first registered vendor, and a
    // wrong one is refused with the registered names -- no name is spelled
    // in the core.
    const registry = builtinModelProviders();
    const providers = { names: registry.names(), default: registry.defaultName() };
    const resolve = (environment: Record<string, string>) =>
      resolveConfig({
        catalog: null,
        project: null,
        sources: { processEnv: { LLM_API_KEY: "k", ...environment }, envFiles: [] },
        configHome: "/tmp/none",
        providers,
        cpuCount: 4,
      });
    expect(resolve({}).provider).toBe("local");
    expect(resolve({ LLM_PROVIDER: "Claude" }).provider).toBe("claude");
    expect(() => resolve({ LLM_PROVIDER: "gemini" })).toThrow(
      "LLM_PROVIDER must be one of ['claude', 'local'], got: 'gemini'",
    );
  });

  it("hands a vendor the shared adapter, so a vendor cannot bring its own chat loop", () => {
    // `AiSdkProvider` is how a vendor is declared, and what it builds is
    // always `AiSdkChatModel` -- the one that makes exactly one call.
    class FakeProvider extends AiSdkProvider {
      readonly name = "fake";
      readonly description = "";
      readonly defaultModel = "m";

      protected languageModel(): MockLanguageModelV3 {
        return mockModel("");
      }
    }
    expect(new FakeProvider().create(choice())).toBeInstanceOf(AiSdkChatModel);
  });
});

/**
 * The catalogue is where an operator names a vendor, so the two files that
 * show them how (`templates/config.yaml`, which `reviewer init` writes, and
 * `docs/config.example.yaml`) must name vendors that exist, and what they
 * name must reach that vendor unchanged.
 */
describe("what the catalogue says about the model", () => {
  const ROOT = join(import.meta.dir, "..", "..", "..");
  const registry = builtinModelProviders();
  const providers = { names: registry.names(), default: registry.defaultName() };

  it.each(["templates/config.yaml", "docs/config.example.yaml"])(
    "%s names only registered vendors, and its llm section reaches one",
    (file) => {
      const path = join(ROOT, file);
      const catalog = parseCatalog(parseYaml(readFileSync(path, "utf8")), path);
      for (const project of catalog.projects.values()) {
        const config = resolveConfig({
          catalog,
          project: project.name,
          sources: { processEnv: { LLM_API_KEY: "k" }, envFiles: [] },
          configHome: "/tmp/none",
          providers,
          cpuCount: 4,
        });
        // The merged `llm` section (defaults, then the project's own keys) is
        // what the run reads: its `provider` is registered, and its `model`
        // is what the vendor is asked for -- through the registry, the way
        // the composition root builds it.
        const llm = catalog.settingsFor(project).llm as { provider?: string; model?: string };
        expect(config.provider).toBe(llm.provider ?? providers.default);
        expect(registry.has(config.provider)).toBe(true);
        expect(config.llmSettings().model).toBe(llm.model ?? null);
        expect(registry.create(config.provider, config.llmSettings())).toBeInstanceOf(
          AiSdkChatModel,
        );
      }
    },
  );
});
