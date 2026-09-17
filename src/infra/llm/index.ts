/**
 * The built-in LLM providers, ready to register.
 *
 * To add a vendor: write `<name>-provider.ts` with an `LLMProvider` and list
 * it here. Nothing else changes -- configuration validates against the
 * registry's names and the composition root builds through it.
 */

import { LLMProviderRegistry } from "../../core/llm/provider-registry";

import { claudeProvider } from "./claude-provider";
import { localProvider } from "./local-provider";

export const BUILTIN_LLM_PROVIDERS = [localProvider, claudeProvider] as const;

export function builtinLLMProviderRegistry(): LLMProviderRegistry {
  return new LLMProviderRegistry(BUILTIN_LLM_PROVIDERS);
}
