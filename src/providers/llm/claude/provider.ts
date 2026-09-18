/**
 * `claude`: Anthropic Claude models.
 *
 * Set `LLM_PROVIDER=claude` and `LLM_API_KEY` to an Anthropic key. Optionally
 * set `LLM_BASE_URL` for a proxy/gateway. Name the model with `LLM_MODEL`
 * (the default `claude-sonnet-4-6` is fast and strong for code review).
 *
 * A vendor class is its four differences and nothing else; the shared
 * adapter, the one-call guarantee and the `ChatModel` port come from
 * `AiSdkProvider`.
 */

import { createAnthropic } from "@ai-sdk/anthropic";
import { type LanguageModel } from "ai";

import { AiSdkProvider } from "../ai-sdk-provider";
import { type ModelRequest } from "../model-provider";

export class ClaudeProvider extends AiSdkProvider {
  readonly name = "claude";
  readonly description = "Anthropic Claude; LLM_API_KEY is an Anthropic key";
  readonly defaultModel = "claude-sonnet-4-6";

  protected languageModel({ apiKey, baseUrl, model }: ModelRequest): LanguageModel {
    return createAnthropic({ apiKey, ...(baseUrl !== null && { baseURL: baseUrl }) })(model);
  }
}
