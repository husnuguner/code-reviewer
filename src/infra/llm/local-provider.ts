/**
 * `local` provider: any OpenAI-compatible endpoint.
 *
 * Covers local servers (LM Studio, Ollama, vLLM, ...) and the cloud OpenAI API
 * alike -- they all speak the OpenAI chat-completions protocol. Driven by the
 * universal `LLM_*` knobs: `LLM_BASE_URL` (omit for api.openai.com) and
 * `LLM_API_KEY` (non-empty even though local servers usually ignore the value).
 */

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

import { type LLMProvider, type ProviderSettings } from "../../core/llm/provider-registry";
import { type ChatModel } from "../../core/ports/chat-model";

import { AiSdkChatModel } from "./ai-sdk-chat-model";

const OPENAI_BASE_URL = "https://api.openai.com/v1";

export const localProvider: LLMProvider = {
  name: "local",
  defaultModel: "gpt-4.1",
  build(settings: ProviderSettings, model: string): ChatModel {
    const client = createOpenAICompatible({
      name: "local",
      baseURL: settings.baseUrl ?? OPENAI_BASE_URL,
      apiKey: settings.apiKey,
    });
    return new AiSdkChatModel(client.chatModel(model));
  },
};
