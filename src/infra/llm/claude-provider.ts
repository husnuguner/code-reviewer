/**
 * `claude` provider: Anthropic Claude models.
 *
 * Set `LLM_PROVIDER=claude` and `LLM_API_KEY` to an Anthropic key. Optionally
 * set `LLM_BASE_URL` for a proxy/gateway. Override the model with `LLM_MODEL`
 * (the default `claude-sonnet-4-6` is fast and strong for code review).
 */

import { createAnthropic } from "@ai-sdk/anthropic";

import { type LLMProvider, type ProviderSettings } from "../../core/llm/provider-registry";
import { type ChatModel } from "../../core/ports/chat-model";

import { AiSdkChatModel } from "./ai-sdk-chat-model";

export const claudeProvider: LLMProvider = {
  name: "claude",
  defaultModel: "claude-sonnet-4-6",
  build(settings: ProviderSettings, model: string): ChatModel {
    const client = createAnthropic({
      apiKey: settings.apiKey,
      ...(settings.baseUrl !== null && { baseURL: settings.baseUrl }),
    });
    return new AiSdkChatModel(client(model));
  },
};
