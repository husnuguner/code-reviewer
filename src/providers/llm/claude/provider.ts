/**
 * `claude`: Anthropic Claude models.
 *
 * Set `LLM_PROVIDER=claude` and `LLM_API_KEY` to an Anthropic key. Optionally
 * set `LLM_BASE_URL` for a proxy/gateway. Name the model with `LLM_MODEL`
 * (the default `claude-sonnet-4-6` is fast and strong for code review).
 *
 * A vendor class is its differences and nothing else; the shared adapter,
 * the one-call guarantee and the `ChatModel` port come from `AiSdkProvider`.
 *
 * The one difference beyond the client is prompt caching. Anthropic keeps a
 * prompt prefix only when asked, block by block, and the reviewer has two
 * prefixes worth asking about: the standing prompt every call of a run
 * shares, and a skills block every file with the same skills shares. The
 * core marks them (`ChatMessage.stable`); this class says what the mark
 * means here.
 */

import { createAnthropic } from "@ai-sdk/anthropic";
import { type LanguageModel } from "ai";

import { type ProviderOptions } from "../ai-sdk-chat-model";
import { AiSdkProvider } from "../ai-sdk-provider";
import { type ModelRequest } from "../model-provider";

/**
 * "Keep this block": Anthropic's cache marker, at the default five-minute
 * life, which a run of any length keeps refreshing with every hit.
 *
 * The arithmetic that makes it worth asking: a kept block costs a quarter
 * more the first time and nine-tenths less every time after, so it pays
 * from the second file on. A run of one file pays the quarter and gets
 * nothing back -- the price of the common case being the pull request. The
 * vendor also declines to keep a block under its minimum (about a thousand
 * tokens for the larger models), silently; the standing prompt and any
 * skills block worth having are both well past it.
 */
export const ANTHROPIC_STABLE_PREFIX: ProviderOptions = {
  anthropic: { cacheControl: { type: "ephemeral" } },
};

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
