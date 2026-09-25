/**
 * Gathering one file's pre-context: the facade the per-file review calls. It picks the file's language,
 * guards the repository port, bounds the port calls, and asks the three block builders in order of value.
 * The model asks for nothing; the review stays one call.
 * @packageDocumentation
 */

import pLimit from "p-limit";

import { type ChangedFile } from "../../domain/changed-file";
import { type CodeContext } from "../../ports/code-context";
import { type LanguageLookup } from "../../ports/language";
import { type Logger, NULL_LOGGER } from "../../ports/logger";
import { cutToLength } from "../../util/text";
import { guardedContext } from "../guards";

import { gatherDefinitions } from "./definitions";
import { NO_LANGUAGES } from "./plain-text";
import { relatedChanges, relationTo } from "./related";
import {
  type ContextLimits,
  DEFAULT_CONTEXT_LIMITS,
  EMPTY_CONTEXT,
  type ReviewContext,
} from "./types";
import { gatherUsages } from "./usages";

/** Port calls in flight per file; multiplies with `maxConcurrentFiles`. */
const MAX_CONCURRENT_LOOKUPS = 4;

/** The smallest share one item (a module's surface, a related diff) is cut to. */
const MIN_CHARS_PER_ITEM = 400;

/** Input to {@link gatherContext}. */
export interface GatherContextOptions {
  readonly file: ChangedFile;
  /** Every changed file of the change set, this one included. */
  readonly changeSet: readonly ChangedFile[];
  readonly context: CodeContext;
  readonly limits?: ContextLimits;
  /**
   * Which language reads each file. Omitted: none, so every file is plain text -- Related by name and
   * directory, no Definitions, no Usages. The composition root passes the built-in languages.
   */
  readonly languages?: LanguageLookup;
  readonly logger?: Logger;
}

/**
 * Gathers a file's surroundings within the limits.
 *
 * @remarks The port is read through {@link guardedContext}: no credential file is read or listed, whatever
 * the patch imports or a search matches, and whatever language reads it.
 * @returns The context. A port call that fails costs that one item, never the review. Results are read
 * back in request order, so the prompt does not depend on which call answered first.
 */
export async function gatherContext(options: GatherContextOptions): Promise<ReviewContext> {
  const limits = options.limits ?? DEFAULT_CONTEXT_LIMITS;
  if (limits.maxChars <= 0) return EMPTY_CONTEXT;
  const { file } = options;
  const languages = options.languages ?? NO_LANGUAGES;
  const language = languages.forPath(file.path);
  const log = (options.logger ?? NULL_LOGGER).child("review.context");
  const context = guardedContext(options.context);
  const maxCharsEach = Math.max(MIN_CHARS_PER_ITEM, Math.floor(limits.maxChars / 4));
  const limit = pLimit(MAX_CONCURRENT_LOOKUPS);
  const schedule = <T>(task: () => Promise<T>): Promise<T> => limit(task);

  // Definitions are queued first: when the pool binds, the more valuable kind is fetched.
  const [definitions, usages] = await Promise.all([
    gatherDefinitions({
      file,
      language,
      context,
      maxDefinitions: limits.maxDefinitions,
      maxCharsEach,
      schedule,
      log,
    }),
    gatherUsages({
      file,
      language,
      context,
      maxSymbols: limits.maxSymbols,
      maxUsagesPerSymbol: limits.maxUsagesPerSymbol,
      schedule,
      log,
    }),
  ]);

  const related = relatedChanges(file, options.changeSet, languages)
    .slice(0, limits.maxRelated)
    .map((other) => ({
      path: other.path,
      relation: relationTo(file, other, languages),
      patch: cutToLength(other.patch, maxCharsEach),
    }));

  return { definitions, usages, related };
}
