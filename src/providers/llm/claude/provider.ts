/**
 * `claude`: Anthropic models. `LLM_API_KEY` is an Anthropic key; `LLM_BASE_URL` optionally a proxy.
 * @packageDocumentation
 */

import { createAnthropic } from "@ai-sdk/anthropic";
import { type LanguageModel } from "ai";

import { type ProviderOptions } from "../ai-sdk-chat-model";
import { AiSdkProvider } from "../ai-sdk-provider";
import { type ModelRequest } from "../model-provider";

/**
 * Anthropic's cache marker for a stable prefix (five-minute life, refreshed on every hit).
 *
 * @remarks A cached block costs a quarter more to write and a tenth to read, so it pays from the second
 * file on. Blocks under the vendor's minimum (~1k tokens) are silently not kept.
 */
export const ANTHROPIC_STABLE_PREFIX: ProviderOptions = {
  anthropic: { cacheControl: { type: "ephemeral" } },
};

/** The Anthropic vendor. */
export class ClaudeProvider extends AiSdkProvider {
  readonly name = "claude";
  readonly description = "Anthropic Claude; LLM_API_KEY is an Anthropic key";
  readonly defaultModel = "claude-sonnet-4-6";

  protected languageModel({ apiKey, baseUrl, model }: ModelRequest): LanguageModel {
    return createAnthropic({ apiKey, ...(baseUrl !== null && { baseURL: baseUrl }) })(model);
  }

  protected override stablePrefix(): ProviderOptions {
    return ANTHROPIC_STABLE_PREFIX;
  }
}
