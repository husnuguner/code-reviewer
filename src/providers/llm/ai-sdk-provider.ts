/**
 * The base for AI SDK vendors: the one place a `LanguageModel` becomes a `ChatModel`, so every vendor
 * shares the adapter and its one-call guarantee.
 * @packageDocumentation
 */

import { type LanguageModel } from "ai";

import { type ChatModel } from "../../core/ports/chat-model";

import { AiSdkChatModel, type ProviderOptions } from "./ai-sdk-chat-model";
import { ModelProvider, type ModelRequest } from "./model-provider";

/** A vendor reached through the AI SDK. Subclasses supply the id, help, default model and SDK client. */
export abstract class AiSdkProvider extends ModelProvider {
  /** The shared adapter over the vendor's SDK model. Final: a vendor cannot write its own chat loop. */
  protected chatModel(request: ModelRequest): ChatModel {
    const stablePrefix = this.stablePrefix();
    return new AiSdkChatModel(this.languageModel(request), {
      ...(stablePrefix !== undefined && { stablePrefix }),
    });
  }

  /**
   * What to attach to a message the core marked `stable`.
   *
   * @returns `undefined` by default; a vendor with on-request prompt caching overrides this.
   */
  protected stablePrefix(): ProviderOptions | undefined {
    return undefined;
  }

  /** The SDK model for one request; `request.model` is already settled. */
  protected abstract languageModel(request: ModelRequest): LanguageModel;
}
