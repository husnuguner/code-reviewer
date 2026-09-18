/**
 * `local`: any OpenAI-compatible endpoint.
 *
 * Covers local servers (LM Studio, Ollama, vLLM, ...) and the cloud OpenAI API
 * alike -- they all speak the OpenAI chat-completions protocol. Driven by the
 * universal `LLM_*` knobs: `LLM_BASE_URL` (omit for api.openai.com) and
 * `LLM_API_KEY` (non-empty even though local servers usually ignore the value).
 */

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { type LanguageModel } from "ai";

import { AiSdkProvider } from "../ai-sdk-provider";
import { type ModelRequest } from "../model-provider";

/** Where an OpenAI-compatible request goes when the run named no endpoint. */
const OPENAI_BASE_URL = "https://api.openai.com/v1";

export class LocalProvider extends AiSdkProvider {
  readonly name = "local";
  readonly description = `any OpenAI-compatible endpoint (LLM_BASE_URL; default ${OPENAI_BASE_URL})`;
  readonly defaultModel = "gpt-4.1";

  protected languageModel({ apiKey, baseUrl, model }: ModelRequest): LanguageModel {
    // The SDK's own label for this client is the provider's id: one name.
    return createOpenAICompatible({
      name: this.name,
      baseURL: baseUrl ?? OPENAI_BASE_URL,
      apiKey,
    }).chatModel(model);
  }
}
