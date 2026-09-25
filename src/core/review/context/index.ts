/**
 * Deterministic pre-context fetched before the model is asked: imported modules' signatures, users of
 * changed exports, and related diffs. The algorithm is here and knows no language; each language's syntax
 * is a `LanguageSupport` (`core/ports/language.ts`) the caller hands in.
 * @packageDocumentation
 */

export { gatherContext, type GatherContextOptions } from "./gather";
export { renderContext } from "./render";
export { relatedChanges, relationTo } from "./related";
export { changedSymbols } from "./symbols";
export { patchSides } from "./patch-sides";
export { directoryOf, extensionOf, fileNameOf, joinRelative } from "./paths";
export { NO_LANGUAGES, PLAIN_TEXT, defaultStem, isSourceLikePath } from "./plain-text";
export {
  type ContextLimits,
  DEFAULT_CONTEXT_LIMITS,
  type DefinitionContext,
  EMPTY_CONTEXT,
  type RelatedChange,
  type RelatedRelation,
  type ReviewContext,
  type UsageContext,
} from "./types";
