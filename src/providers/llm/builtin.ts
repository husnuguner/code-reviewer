/**
 * The built-in model providers, ready to register.
 *
 * To add a vendor: write `providers/<name>.ts` extending `AiSdkProvider`, and
 * list an instance here. Nothing else changes -- configuration validates
 * `LLM_PROVIDER` against the registry's names, its descriptions are what a
 * refusal and the docs quote, and the composition root builds through it.
 *
 * The order here is the order the names are listed in, and the first is what
 * `LLM_PROVIDER` means when unset.
 */

import { ClaudeProvider } from "./claude/provider";
import { LocalProvider } from "./local/provider";
import { type ModelProvider, ModelProviderRegistry } from "./model-provider";

export const BUILTIN_MODEL_PROVIDERS: readonly ModelProvider[] = [
  new LocalProvider(),
  new ClaudeProvider(),
];

export function builtinModelProviders(): ModelProviderRegistry {
  return new ModelProviderRegistry(BUILTIN_MODEL_PROVIDERS);
}
