/**
 * How a vendor becomes a `ModelProvider`: extend this, and say which AI SDK
 * model a request builds.
 *
 * The one place a `LanguageModel` turns into a `ChatModel`, so every vendor
 * gets the same adapter and its guarantees -- one call, once, with the SDK's
 * own retry off (`ai-sdk-chat-model`). A vendor that built a `ChatModel`
 * directly could write its own chat loop and its own retry, and then two of
 * the three attempts an operator configured would be invisible and billed;
 * `chatModel` being final here is what makes that impossible rather than
 * merely discouraged.
 *
 * What is left for a vendor class is exactly what differs between vendors:
 * the id, the line of help, the default model, the SDK client -- and, for a
 * vendor that keeps prompt prefixes on request, what the request looks like.
 */

import { type LanguageModel } from "ai";

import { type ChatModel } from "../../core/ports/chat-model";

import { AiSdkChatModel, type ProviderOptions } from "./ai-sdk-chat-model";
import { ModelProvider, type ModelRequest } from "./model-provider";

export abstract class AiSdkProvider extends ModelProvider {
  /** The shared adapter over the vendor's SDK model; not a vendor's to change. */
  protected chatModel(request: ModelRequest): ChatModel {
    const stablePrefix = this.stablePrefix();
    return new AiSdkChatModel(this.languageModel(request), {
      ...(stablePrefix !== undefined && { stablePrefix }),
    });
  }

  /**
   * What to attach to a message the core marked `stable`, so this vendor
   * keeps it for the run's later calls.
   *
   * `undefined` by default, which is right for most: an OpenAI-compatible
   * server that caches prefixes does so unasked, and one that does not has
   * nothing to be asked. A vendor that wants telling overrides this once,
   * and the core's flag reaches it without the core learning its name.
   */
  protected stablePrefix(): ProviderOptions | undefined {
    return undefined;
  }

  /** The SDK model for one request; `request.model` is already settled. */
  protected abstract languageModel(request: ModelRequest): LanguageModel;
}
