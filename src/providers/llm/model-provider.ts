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
  /** Where requests go when the configuration names no base URL; `null` leaves it to the vendor's SDK. */
  readonly defaultEndpoint: string | null = null;

  /** The model used when the configuration names none. */
  abstract readonly defaultModel: string;

  /**
   * The model and the endpoint a run with these settings talks to, as the log names them: the question a
   * surprising answer (a 401, a model nobody chose) starts from.
   */
  target(settings: LlmSettings): string {
    const endpoint = settings.baseUrl ?? this.defaultEndpoint ?? "the vendor's default endpoint";
    return `${settings.model ?? this.defaultModel} at ${endpoint}`;
  }

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
