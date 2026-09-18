/**
 * The public surface of the providers layer, for an embedder that composes
 * the core with its own choices.
 *
 * The core (`code-reviewer/core`) asks for ports and knows nothing else. This
 * module is where the choices live: the mechanism (`Provider`,
 * `ProviderRegistry`), the three kinds this program declares with it, and the
 * built-in instances. An embedder adds a vendor, a host or a rendering the
 * same way the built-ins are added -- extend the kind, hand an instance to
 * the registry -- and never edits the core to do it.
 */

export { Provider } from "./provider";
export { ProviderRegistry } from "./registry";

export { ModelProvider, ModelProviderRegistry } from "./llm/model-provider";
export type { ModelRequest } from "./llm/model-provider";
export { AiSdkProvider } from "./llm/ai-sdk-provider";
export { BUILTIN_MODEL_PROVIDERS, builtinModelProviders } from "./llm/builtin";

export { RepositoryProvider, RepositoryProviderRegistry } from "./repository/repository-provider";
export type { RepositorySettings } from "./repository/repository-provider";
export { BUILTIN_REPOSITORY_PROVIDERS, builtinRepositoryProviders } from "./repository/builtin";

export { FormatProvider, FormatProviderRegistry } from "./reporting/format-provider";
export type { ReportContext } from "./reporting/format-provider";
export { BUILTIN_FORMAT_PROVIDERS, builtinFormatProviders } from "./reporting/builtin";
