/**
 * The LLM provider registry: which vendors a run may name in `LLM_PROVIDER`.
 *
 * A provider is a small factory with a `name` and a `defaultModel`; declaring
 * one and registering it is all it takes to make it selectable. The core owns
 * the registry so that configuration can validate `LLM_PROVIDER` against the
 * registered names without importing any vendor SDK; the infrastructure layer
 * registers the concrete providers at composition time.
 *
 * Every provider takes the same three universal knobs (api key, optional base
 * url, optional model override), read once from `LLM_API_KEY` / `LLM_BASE_URL`
 * / `LLM_MODEL`.
 */

import { type ChatModel } from "../ports/chat-model";
import { ValueError } from "../util/errors";
import { pyRepr, pySorted } from "../util/py";

/** The universal knobs a provider is built from. */
export interface ProviderSettings {
  readonly provider: string;
  /** Required; must be non-empty even for a local server. */
  readonly apiKey: string;
  readonly baseUrl: string | null;
  /** `null` -> the provider's `defaultModel`. */
  readonly modelName: string | null;
}

/** Everything the registry needs to know about one vendor. */
export interface LLMProvider {
  /** Unique id used in `LLM_PROVIDER`. */
  readonly name: string;
  /** Model used when `LLM_MODEL` is not set. */
  readonly defaultModel: string;
  /** Build a non-streaming chat model for these settings. */
  build(settings: ProviderSettings, model: string): ChatModel;
}

export class LLMProviderRegistry {
  private readonly providers = new Map<string, LLMProvider>();

  constructor(providers: readonly LLMProvider[] = []) {
    for (const provider of providers) this.register(provider);
  }

  register(provider: LLMProvider): void {
    this.providers.set(provider.name, provider);
  }

  /** Sorted names of all registered providers (for validation/help text). */
  names(): string[] {
    return pySorted(this.providers.keys());
  }

  has(name: string): boolean {
    return this.providers.has(name);
  }

  /** The chat model `settings.provider` names, with the model override applied. */
  build(settings: ProviderSettings): ChatModel {
    const provider = this.providers.get(settings.provider);
    if (provider === undefined) {
      throw new ValueError(
        `Unknown LLM provider ${pyRepr(settings.provider)}; available: ${pyRepr(this.names())}`,
      );
    }
    const model = settings.modelName ?? provider.defaultModel;
    return provider.build(settings, model);
  }
}
