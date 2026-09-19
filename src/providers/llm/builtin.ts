/**
 * The built-in model providers. To add a vendor: extend `AiSdkProvider` and list an instance here.
 * @packageDocumentation
 */

import { ClaudeProvider } from "./claude/provider";
import { LocalProvider } from "./local/provider";
import { type ModelProvider, ModelProviderRegistry } from "./model-provider";

/** In listing order; the first is what `LLM_PROVIDER` means when unset. */
export const BUILTIN_MODEL_PROVIDERS: readonly ModelProvider[] = [
  new LocalProvider(),
  new ClaudeProvider(),
];

/** A registry of the built-in model providers. */
export function builtinModelProviders(): ModelProviderRegistry {
  return new ModelProviderRegistry(BUILTIN_MODEL_PROVIDERS);
}
