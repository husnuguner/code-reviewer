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
 * the id, the line of help, the default model, and the SDK client.
 */

import { type LanguageModel } from "ai";

import { type ChatModel } from "../../core/ports/chat-model";

import { AiSdkChatModel } from "./ai-sdk-chat-model";
import { ModelProvider, type ModelRequest } from "./model-provider";

export abstract class AiSdkProvider extends ModelProvider {
  /** The shared adapter over the vendor's SDK model; not a vendor's to change. */
  protected chatModel(request: ModelRequest): ChatModel {
    return new AiSdkChatModel(this.languageModel(request));
  }

  /** The SDK model for one request; `request.model` is already settled. */
  protected abstract languageModel(request: ModelRequest): LanguageModel;
}
