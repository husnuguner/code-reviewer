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
import { Registry, type RegistryEntry } from "../util/registry";

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
export interface LLMProvider extends RegistryEntry {
  /** Unique id used in `LLM_PROVIDER`. */
  readonly name: string;
  /** Model used when `LLM_MODEL` is not set. */
  readonly defaultModel: string;
  /** Build a non-streaming chat model for these settings. */
  build(settings: ProviderSettings, model: string): ChatModel;
}

/**
 * A `Registry` of vendors. Selection, listing and the refusal a wrong name
 * meets are the shared ones; only the build below is this registry's own,
 * because only here does a name carry a second setting (the model) that the
 * entry itself supplies a default for.
 *
 * There is deliberately no `description`: a provider is named in the
 * environment rather than in a `--help` line, so nothing would read one.
 */
export class LLMProviderRegistry extends Registry<LLMProvider> {
  constructor(providers: readonly LLMProvider[] = []) {
    super("LLM provider", providers);
  }

  /** The chat model `settings.provider` names, with the model override applied. */
  build(settings: ProviderSettings): ChatModel {
    const provider = this.get(settings.provider);
    return provider.build(settings, settings.modelName ?? provider.defaultModel);
  }
}
