/**
 * What pre-context gathers and how much of it: the value types every part of the context module shares.
 * @packageDocumentation
 */

/** How much context one file review may gather. */
export interface ContextLimits {
  /** Cap on the rendered block; `0` switches gathering off. */
  readonly maxChars: number;
  /** Local imports resolved per file. */
  readonly maxDefinitions: number;
  /** Changed exports searched for per file; one repository search each. */
  readonly maxSymbols: number;
  /** Paths listed per changed export. */
  readonly maxUsagesPerSymbol: number;
  /** Related diffs included. */
  readonly maxRelated: number;
}

/**
 * The built-in limits, for a caller that gathers context without a configuration.
 *
 * @remarks The same numbers as `DEFAULT_FILE_REVIEW_SETTINGS`, which is where a run reads them from;
 * the two are held together by a test. Every one of them is a config-file setting, on purpose: how much
 * of the repository a review reads is a judgement about the code, not about the shell it runs in.
 */
export const DEFAULT_CONTEXT_LIMITS: ContextLimits = {
  maxChars: 12_000,
  maxDefinitions: 4,
  maxSymbols: 6,
  maxUsagesPerSymbol: 8,
  maxRelated: 3,
};

/** One imported module's exported surface. */
export interface DefinitionContext {
  /** The import specifier as written (`./service`). */
  readonly specifier: string;
  /** The repository-relative path it resolved to. */
  readonly path: string;
  /** The module's exported signatures, trimmed. */
  readonly signatures: string;
}

/** Where else a changed export is mentioned. */
export interface UsageContext {
  readonly symbol: string;
  /** Other files mentioning the symbol, in code-point order. */
  readonly paths: readonly string[];
}

/**
 * How a related change is related to the file under review.
 *
 * @remarks An import edge is the relation a change actually breaks; the name heuristics are a guess.
 */
export type RelatedRelation =
  /** The file under review imports it. */
  | "imports"
  /** It imports the file under review. */
  | "imported-by"
  /** Neither imports the other: same stem, or same directory. */
  | "sibling";

/** Another changed file's diff. */
export interface RelatedChange {
  readonly path: string;
  /** Why it is here; rendered into the prompt so the model knows what it is looking at. */
  readonly relation: RelatedRelation;
  readonly patch: string;
}

/** Everything gathered for one file. */
export interface ReviewContext {
  readonly definitions: readonly DefinitionContext[];
  readonly usages: readonly UsageContext[];
  readonly related: readonly RelatedChange[];
}

/** Nothing gathered. */
export const EMPTY_CONTEXT: ReviewContext = { definitions: [], usages: [], related: [] };
