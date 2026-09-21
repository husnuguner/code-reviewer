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

import { buildConfig } from "../../../src/core/config/config";
import { parseConfigFile } from "../../../src/core/config/parse";
import { type LlmSettings } from "../../../src/core/config/settings";
import { ValueError } from "../../../src/core/util/errors";
import { AiSdkChatModel, toPrompt } from "../../../src/providers/llm/ai-sdk-chat-model";
import { AiSdkProvider } from "../../../src/providers/llm/ai-sdk-provider";
import { BUILTIN_MODEL_PROVIDERS, builtinModelProviders } from "../../../src/providers/llm/builtin";
import {
  ANTHROPIC_STABLE_PREFIX,
  ClaudeProvider,
} from "../../../src/providers/llm/claude/provider";
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

  it("hands up the vendor's token counts, and says nothing where it counted nothing", async () => {
    const counted = await new AiSdkChatModel(mockModel("ok")).generate([
      { role: "user", content: "u" },
    ]);
    expect(counted.usage).toEqual({
      inputTokens: 1,
      outputTokens: 1,
      cacheReadTokens: null,
      cacheWriteTokens: null,
    });

    const silent: LanguageModelV3GenerateResult = {
      content: [{ type: "text", text: "ok" }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: {
        inputTokens: { ...TOKENS, total: undefined },
        outputTokens: { ...TOKENS, total: undefined, text: undefined, reasoning: undefined },
      },
      warnings: [],
    };
    const uncounted = await new AiSdkChatModel(
      new MockLanguageModelV3({ doGenerate: () => Promise.resolve(silent) }),
    ).generate([{ role: "user", content: "u" }]);
    expect(uncounted.usage).toEqual({
      inputTokens: null,
      outputTokens: null,
      cacheReadTokens: null,
      cacheWriteTokens: null,
    });
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

  it("keeps system messages apart as a list, several staying several, in order", () => {
    // A list rather than one joined string: a string cannot carry the option
    // that asks a vendor to keep it, and a block is what a cache boundary
    // sits on.
    expect(
      toPrompt(
        [
          { role: "system", content: "A" },
          { role: "user", content: "u1" },
          { role: "system", content: "B" },
          { role: "assistant", content: "a1" },
        ],
        undefined,
      ),
    ).toEqual({
      instructions: [
        { role: "system", content: "A" },
        { role: "system", content: "B" },
      ],
      conversation: [
        { role: "user", content: "u1" },
        { role: "assistant", content: "a1" },
      ],
    });
    expect(toPrompt([{ role: "user", content: "u" }], undefined).instructions).toEqual([]);
  });

  it("attaches the vendor's keep-this options to stable messages only", () => {
    const keep = { vendor: { keep: true } };
    expect(
      toPrompt(
        [
          { role: "system", content: "POLICY", stable: true },
          { role: "user", content: "SKILLS", stable: true },
          { role: "user", content: "FILE" },
        ],
        keep,
      ),
    ).toEqual({
      instructions: [{ role: "system", content: "POLICY", providerOptions: keep }],
      conversation: [
        { role: "user", content: "SKILLS", providerOptions: keep },
        { role: "user", content: "FILE" },
      ],
    });
  });

  it("leaves the flag without effect for a vendor with nothing to ask for", () => {
    // The core marks what is stable whatever the vendor; a vendor that
    // caches unasked, or not at all, must see plain messages.
    expect(
      toPrompt([{ role: "system", content: "POLICY", stable: true }], undefined).instructions,
    ).toEqual([{ role: "system", content: "POLICY" }]);
  });

  it("sends the stable prefix to the SDK with the vendor's options on it", async () => {
    const model = mockModel("ok");
    await new AiSdkChatModel(model, { stablePrefix: ANTHROPIC_STABLE_PREFIX }).generate([
      { role: "system", content: "POLICY", stable: true },
      { role: "user", content: "FILE" },
    ]);
    const prompt = model.doGenerateCalls[0]?.prompt ?? [];
    expect(prompt[0]?.providerOptions).toEqual(ANTHROPIC_STABLE_PREFIX);
    expect(prompt[1]?.providerOptions).toBeUndefined();
  });

  it("hands up what the vendor kept and reused, and nothing when it did neither", async () => {
    const cached: LanguageModelV3GenerateResult = {
      content: [{ type: "text", text: "ok" }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: {
        inputTokens: { total: 9445, noCache: 1795, cacheRead: 7650, cacheWrite: 0 },
        outputTokens: { total: 2455, text: 2455, reasoning: 0 },
      },
      warnings: [],
    };
    const response = await new AiSdkChatModel(
      new MockLanguageModelV3({ doGenerate: () => Promise.resolve(cached) }),
    ).generate([{ role: "user", content: "u" }]);
    expect(response.usage).toEqual({
      inputTokens: 9445,
      outputTokens: 2455,
      cacheReadTokens: 7650,
      cacheWriteTokens: 0,
    });
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

  it("asks the vendor for JSON when the caller does, and hands the answer up as text", async () => {
    const model = mockModel('{"findings": []}');
    const response = await new AiSdkChatModel(model).generate([{ role: "user", content: "u" }], {
      responseFormat: "json",
    });
    expect(model.doGenerateCalls[0]?.responseFormat).toEqual({ type: "json" });
    expect(response.text).toBe('{"findings": []}');
  });

  it("asks for no particular format when the caller says nothing about it", async () => {
    const model = mockModel("ok");
    await new AiSdkChatModel(model).generate([{ role: "user", content: "u" }]);
    expect(model.doGenerateCalls[0]?.responseFormat).toBeUndefined();
  });

  it("asks for no format from a vendor without a schema-less JSON mode, even when the caller wants JSON", async () => {
    // Anthropic's JSON output wants a schema; asked for the schema-less kind
    // the SDK ignores it and warns on every call. The answer is read by the
    // reviewer's own parser either way, so the request is simply not made.
    const model = mockModel('{"findings": []}');
    const response = await new AiSdkChatModel(model, { supportsJsonMode: false }).generate(
      [{ role: "user", content: "u" }],
      { responseFormat: "json" },
    );
    expect(model.doGenerateCalls[0]?.responseFormat).toBeUndefined();
    expect(response.text).toBe('{"findings": []}');
  });

  it("hands up an answer that is not JSON as text, leaving the retry to the caller", async () => {
    // The SDK parses a JSON-mode answer itself and throws when it cannot.
    // The reviewer has a tolerant parser and its own malformed-JSON retry,
    // so the raw text must reach it -- with the tokens it cost.
    const model = mockModel("Here you go: ```json\n{}\n```");
    const response = await new AiSdkChatModel(model).generate([{ role: "user", content: "u" }], {
      responseFormat: "json",
    });
    expect(response).toEqual({
      text: "Here you go: ```json\n{}\n```",
      usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: null, cacheWriteTokens: null },
    });
    expect(model.doGenerateCalls).toHaveLength(1);
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

  it("asks Anthropic to keep the stable prefix, and asks nothing of a local endpoint", async () => {
    // The vendor class decides what `stable` means; the adapter it builds
    // must carry that decision. Probed through a mock SDK model so the
    // wiring is tested without the network.
    class Probe extends ClaudeProvider {
      readonly model = mockModel("ok");
      protected override languageModel(): MockLanguageModelV3 {
        return this.model;
      }
    }
    const claude = new Probe();
    await claude.create(choice()).generate([
      { role: "system", content: "POLICY", stable: true },
      { role: "user", content: "FILE" },
    ]);
    expect(claude.model.doGenerateCalls[0]?.prompt[0]?.providerOptions).toEqual(
      ANTHROPIC_STABLE_PREFIX,
    );
    expect(ANTHROPIC_STABLE_PREFIX).toEqual({
      anthropic: { cacheControl: { type: "ephemeral" } },
    });

    class LocalProbe extends AiSdkProvider {
      readonly name = "probe";
      readonly description = "a vendor that asks for nothing";
      readonly defaultModel = "m";
      readonly model = mockModel("ok");
      protected languageModel(): MockLanguageModelV3 {
        return this.model;
      }
    }
    const local = new LocalProbe();
    await local.create(choice()).generate([
      { role: "system", content: "POLICY", stable: true },
      { role: "user", content: "FILE" },
    ]);
    expect(local.model.doGenerateCalls[0]?.prompt[0]?.providerOptions).toBeUndefined();
  });

  it("asks a local endpoint for JSON mode and Anthropic for none, which it would only warn about", async () => {
    // Same wiring, other capability: the vendor class says whether a
    // schema-less JSON mode exists, and the adapter it builds asks accordingly.
    class ClaudeProbe extends ClaudeProvider {
      readonly model = mockModel("{}");
      protected override languageModel(): MockLanguageModelV3 {
        return this.model;
      }
    }
    class LocalProbe extends AiSdkProvider {
      readonly name = "probe";
      readonly description = "an OpenAI-compatible vendor";
      readonly defaultModel = "m";
      readonly model = mockModel("{}");
      protected languageModel(): MockLanguageModelV3 {
        return this.model;
      }
    }
    const claude = new ClaudeProbe();
    const local = new LocalProbe();
    const ask = { responseFormat: "json" } as const;
    await claude.create(choice()).generate([{ role: "user", content: "FILE" }], ask);
    await local.create(choice()).generate([{ role: "user", content: "FILE" }], ask);
    expect(claude.model.doGenerateCalls[0]?.responseFormat).toBeUndefined();
    expect(local.model.doGenerateCalls[0]?.responseFormat).toEqual({ type: "json" });
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
      buildConfig({
        environment: { LLM_API_KEY: "k", ...environment },
        providers,
        cpuCount: 4,
      });
    expect(resolve({}).provider).toBe("local");
    expect(resolve({ LLM_PROVIDER: "Claude" }).provider).toBe("claude");
    expect(() => resolve({ LLM_PROVIDER: "gemini" })).toThrow(
      /settings\.llm\.provider: must be one of \['claude', 'local'\], got: 'gemini'/u,
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
 * A config file is where an operator names a vendor, so the two files that
 * show them how (`templates/config.yaml`, which `reviewer init` writes, and
 * `templates/config.example.yaml`, the annotated reference) must name vendors
 * that exist, and what they name must reach that vendor unchanged.
 */
describe("what the config files say about the model", () => {
  const ROOT = join(import.meta.dir, "..", "..", "..");
  const registry = builtinModelProviders();
  const providers = { names: registry.names(), default: registry.defaultName() };

  it.each(["templates/config.yaml", "templates/config.example.yaml"])(
    "%s names only registered vendors, and its llm section reaches one",
    (file) => {
      const path = join(ROOT, file);
      // The example file carries the repository-only `skills` key too, so it is read as a repository's.
      const home = file.endsWith("config.example.yaml") ? "repo" : "machine";
      const parsed = parseConfigFile(parseYaml(readFileSync(path, "utf8")), path, home);
      const config = buildConfig({
        environment: { LLM_API_KEY: "k" },
        files: [parsed],
        providers,
        cpuCount: 4,
      });
      // The file's `llm` section is what the run reads: its `provider` is
      // registered, and its `model` is what the vendor is asked for -- through
      // the registry, the way the composition root builds it.
      const settings = parsed.values["settings"] as { llm?: { provider?: string; model?: string } };
      const llm = settings.llm ?? {};
      expect(config.provider).toBe(llm.provider ?? providers.default);
      expect(registry.has(config.provider)).toBe(true);
      expect(config.llmSettings().model).toBe(llm.model ?? null);
      expect(registry.create(config.provider, config.llmSettings())).toBeInstanceOf(AiSdkChatModel);
    },
  );
});
