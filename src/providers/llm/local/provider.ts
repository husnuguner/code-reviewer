/**
 * `local`: any OpenAI-compatible endpoint (LM Studio, Ollama, vLLM, or the OpenAI API itself).
 * @packageDocumentation
 */

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { type LanguageModel } from "ai";

import { AiSdkProvider } from "../ai-sdk-provider";
import { type ModelRequest } from "../model-provider";

/** The endpoint when the run names none. */
const OPENAI_BASE_URL = "https://api.openai.com/v1";

/** The OpenAI-compatible vendor. */
export class LocalProvider extends AiSdkProvider {
  readonly name = "local";
  readonly description = `any OpenAI-compatible endpoint (LLM_BASE_URL; default ${OPENAI_BASE_URL})`;
  readonly defaultModel = "gpt-4.1";
  /** The OpenAI API itself: `local` names the protocol, not where the model runs. */
  override readonly defaultEndpoint = OPENAI_BASE_URL;

  protected languageModel({ apiKey, baseUrl, model }: ModelRequest): LanguageModel {
    return createOpenAICompatible({
      name: this.name,
      baseURL: baseUrl ?? OPENAI_BASE_URL,
      apiKey,
    }).chatModel(model);
  }
}
