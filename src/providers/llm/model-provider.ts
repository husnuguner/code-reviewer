/**
 * The model-provider kind: the vendors `LLM_PROVIDER` may name. Builds the core's `ChatModel` from `LlmSettings`.
 * @packageDocumentation
 */

import { type LlmSettings } from "../../core/config/settings";
import { type ChatModel } from "../../core/ports/chat-model";
import { Provider } from "../provider";
import { ProviderRegistry } from "../registry";

/** The configuration's knobs with the model settled. */
export interface ModelRequest extends Omit<LlmSettings, "model"> {
  /** The configured model, else the provider's default. */
  readonly model: string;
}

/** One vendor. Subclasses say who they are and how a request becomes a chat model. */
export abstract class ModelProvider extends Provider<LlmSettings, ChatModel> {
  /** The model used when the configuration names none. */
  abstract readonly defaultModel: string;

  /** Builds the chat model, defaulting the model name. */
  create(settings: LlmSettings): ChatModel {
    return this.chatModel({ ...settings, model: settings.model ?? this.defaultModel });
  }

  /** Builds the port for a request whose model is settled. */
  protected abstract chatModel(request: ModelRequest): ChatModel;
}

/** The vendors, selectable by name. */
export class ModelProviderRegistry extends ProviderRegistry<LlmSettings, ChatModel, ModelProvider> {
  constructor(providers: readonly ModelProvider[] = []) {
    super("LLM provider", providers);
  }
}
