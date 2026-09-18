/**
 * The model-provider kind: which vendors a run may name in `LLM_PROVIDER`.
 *
 * A model provider builds the core's `ChatModel` port out of the model knobs
 * the configuration settled, and knows one thing more than the mechanism
 * does: the model to use when the configuration named none. Declaring a
 * subclass and listing an instance in `builtin.ts` is all it takes to make a
 * vendor selectable.
 *
 * The core is not told any of this. It asks for a `ChatModel` and is handed
 * one by the composition root; `LlmSettings` is the core's own description of
 * the knobs, read here rather than declared here, so this layer depends on
 * the core and never the other way round.
 */

import { type LlmSettings } from "../../core/config/settings";
import { type ChatModel } from "../../core/ports/chat-model";
import { Provider } from "../provider";
import { ProviderRegistry } from "../registry";

/** What a vendor is handed: the configuration's knobs, with the model settled. */
export interface ModelRequest extends Omit<LlmSettings, "model"> {
  /** The configuration's model if it named one, else the provider's default. */
  readonly model: string;
}

/**
 * One vendor. Subclasses say who they are and how a request becomes a chat
 * model; resolving the model is done here, once, so the configuration always
 * wins and a vendor only ever sees a request that names one.
 */
export abstract class ModelProvider extends Provider<LlmSettings, ChatModel> {
  /** Model used when the configuration names none. */
  abstract readonly defaultModel: string;

  /** The chat model for the configuration's settings, defaulting the model. */
  create(settings: LlmSettings): ChatModel {
    return this.chatModel({ ...settings, model: settings.model ?? this.defaultModel });
  }

  /** Build the port for a request whose model is settled. */
  protected abstract chatModel(request: ModelRequest): ChatModel;
}

/** The vendors, selectable by name; nothing here is its own. */
export class ModelProviderRegistry extends ProviderRegistry<LlmSettings, ChatModel, ModelProvider> {
  constructor(providers: readonly ModelProvider[] = []) {
    super("LLM provider", providers);
  }
}
