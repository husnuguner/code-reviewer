/**
 * The public surface of the providers layer: the mechanism, the kinds, and the built-in instances.
 * @packageDocumentation
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

export { Language } from "./languages/language";
export { LanguageRegistry } from "./languages/registry";
export { TypeScriptLanguage } from "./languages/typescript/language";
export type { TypeScriptLanguageOptions } from "./languages/typescript/language";
export { BUILTIN_LANGUAGES, builtinLanguages } from "./languages/builtin";
