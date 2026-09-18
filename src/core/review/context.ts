/**
 * Deterministic pre-context: what the reviewer fetches for the model *before*
 * asking it to judge a file, so that fewer findings rest on assumptions.
 *
 * Three kinds, in the order they are worth their characters:
 *
 * 1. **Definitions** -- for each local module the added lines import, the
 *    exported signatures of that module. Answers "what does the thing I am
 *    calling actually do / take / return".
 * 2. **Usages** -- for each exported symbol the patch adds, removes or changes,
 *    where else in the repository it appears. Answers "is this signature change
 *    breaking anyone" without sending those files.
 * 3. **Related changes** -- the diffs of the other changed files beside this
 *    one (same directory, or the same stem: `foo.ts` / `foo.test.ts`). Answers
 *    "was the counterpart updated too".
 *
 * The model asks no questions; this module guesses what it would have asked.
 * That keeps the review a single call and the output contract untouched: the
 * context is one more block in the user prompt, capped by `maxChars`, and the
 * finding's `existing_code` must still quote the diff. Everything here is pure
 * except the two port calls; the heuristics are regex-level and tuned for
 * TypeScript/JavaScript first.
 */

import pLimit from "p-limit";

import { type ChangedFile } from "../domain/changed-file";
import { type CodeContext } from "../ports/code-context";
import { type Logger, NULL_LOGGER } from "../ports/logger";
import { errorMessage } from "../util/errors";
import { cutToLength, sortedByCodePoint } from "../util/text";

/** How much context one file review may gather. */
export interface ContextLimits {
  /** Cap on the rendered block; `0` switches context gathering off. */
  readonly maxChars: number;
  /** Local imports resolved per file. */
  readonly maxDefinitions: number;
  /**
   * Changed exports searched for per file -- one repository search each, so
   * this is what keeps a file that rewrites thirty exports from spending
   * thirty searches on a section the char cap may drop whole.
   */
  readonly maxSymbols: number;
  /** Paths listed per changed export. */
  readonly maxUsagesPerSymbol: number;
  /** Related diffs included. */
  readonly maxRelated: number;
}

export const DEFAULT_CONTEXT_LIMITS: ContextLimits = {
  maxChars: 6000,
  maxDefinitions: 4,
  maxSymbols: 6,
  maxUsagesPerSymbol: 8,
  maxRelated: 3,
};

/**
 * Port calls in flight for one file's gathering. The file loop above is
 * already concurrent (`maxConcurrentFiles`), so the two multiply: a small
 * pool overlaps a file's reads and searches without letting one review fan
 * out into dozens of git subprocesses at once -- and each of those is itself
 * a parallel, CPU-bound search, which oversubscription makes slower rather
 * than faster.
 */
const MAX_CONCURRENT_LOOKUPS = 4;

export interface DefinitionContext {
  /** The import specifier as written (`./service`). */
  readonly specifier: string;
  /** The repo-relative path it resolved to. */
  readonly path: string;
  /** The module's exported signatures, trimmed. */
  readonly signatures: string;
}

export interface UsageContext {
  readonly symbol: string;
  /** Other files mentioning the symbol, in code-point order. */
  readonly paths: readonly string[];
}

export interface RelatedChange {
  readonly path: string;
  readonly patch: string;
}

export interface ReviewContext {
  readonly definitions: readonly DefinitionContext[];
  readonly usages: readonly UsageContext[];
  readonly related: readonly RelatedChange[];
}

export const EMPTY_CONTEXT: ReviewContext = { definitions: [], usages: [], related: [] };

// -- what the patch says ------------------------------------------------------

/** The added and removed lines of a unified diff, without their markers. */
function changedLines(patch: string): { added: string[]; removed: string[] } {
  const added: string[] = [];
  const removed: string[] = [];
  for (const line of patch.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) added.push(line.slice(1));
    else if (line.startsWith("-")) removed.push(line.slice(1));
  }
  return { added, removed };
}

const IMPORT_SPECIFIER =
  /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["']((?:\.{1,2}\/)[^"']+)["']/gu;

/**
 * Relative module specifiers the added lines import (`./x`, `../y/z`), each
 * once, in first-seen order. Package imports are not local and are skipped.
 */
export function localImports(patch: string): string[] {
  const seen = new Set<string>();
  for (const line of changedLines(patch).added) {
    for (const match of line.matchAll(IMPORT_SPECIFIER)) {
      const specifier = match[1];
      if (specifier !== undefined) seen.add(specifier);
    }
  }
  return [...seen];
}

const EXPORTED_SYMBOL =
  /^\s*export\s+(?:default\s+)?(?:async\s+)?(?:const|let|var|function\*?|class|interface|type|enum|abstract\s+class)\s+([A-Za-z_$][\w$]*)/u;

/** The names the lines declare an `export` of. */
function exportedNames(lines: readonly string[]): Set<string> {
  const names = new Set<string>();
  for (const line of lines) {
    const match = EXPORTED_SYMBOL.exec(line);
    if (match?.[1] !== undefined) names.add(match[1]);
  }
  return names;
}

/**
 * Names the patch adds, removes or edits an `export` declaration of, **most
 * worth asking about first**. A symbol on both sides is an edited signature --
 * the case that breaks callers -- so it outranks one that appears on a single
 * side, which is a new or deleted export. Within a rank the order is
 * alphabetical, so the answer is the same on every run.
 *
 * The rank is what makes `maxSymbols` safe to apply: a cap over an
 * alphabetical list would drop the breaking change because its name starts
 * with a `t`.
 */
export function changedExports(patch: string): string[] {
  const { added, removed } = changedLines(patch);
  const inAdded = exportedNames(added);
  const inRemoved = exportedNames(removed);
  const edited = (name: string): number => (inAdded.has(name) && inRemoved.has(name) ? 0 : 1);
  return sortedByCodePoint(exportedNames([...added, ...removed])).toSorted(
    (a, b) => edited(a) - edited(b),
  );
}

// -- what the repository says -------------------------------------------------

const MODULE_SUFFIXES = [
  "",
  ".ts",
  ".tsx",
  ".mts",
  ".js",
  ".mjs",
  ".jsx",
  "/index.ts",
  "/index.tsx",
  "/index.js",
];

/** `./x` from `src/a/b.ts` is `src/a/x`; `..` climbs; the result never leaves the root. */
export function resolveSpecifier(fromPath: string, specifier: string): string {
  const base = fromPath.split("/").slice(0, -1);
  for (const segment of specifier.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      base.pop();
      continue;
    }
    base.push(segment);
  }
  return base.join("/");
}

/** Strip a `.js`/`.ts`-style extension a specifier may carry (`./x.js` -> `./x`). */
function withoutExtension(path: string): string {
  return path.replace(/\.(?:[cm]?[jt]sx?)$/u, "");
}

/**
 * The first candidate file the module resolves to at the ref, with its text;
 * `null` when none exists. Tries the bare path first (a specifier with an
 * extension), then the usual suffixes.
 */
async function resolveModule(
  fromPath: string,
  specifier: string,
  context: CodeContext,
): Promise<{ path: string; text: string } | null> {
  const stem = resolveSpecifier(fromPath, specifier);
  const bases = stem === withoutExtension(stem) ? [stem] : [stem, withoutExtension(stem)];
  const candidates = bases
    .flatMap((base) => MODULE_SUFFIXES.map((suffix) => `${base}${suffix}`))
    .filter((path) => path !== fromPath);
  for (const path of candidates) {
    const text = await context.readFile(path);
    if (text !== null) return { path, text };
  }
  return null;
}

const JSDOC_LINES_KEPT = 6;

/**
 * The exported surface of a module: each `export` line with the JSDoc block
 * above it (trimmed to a few lines), or -- for a module that exports nothing
 * recognisable -- its first lines. Capped by `maxChars`.
 */
export function exportSignatures(text: string, maxChars: number): string {
  const lines = text.split("\n");
  const kept: string[] = [];
  for (const [index, line] of lines.entries()) {
    if (!/^\s*export\b/u.test(line)) continue;
    kept.push(...documentBlockAbove(lines, index), line.trimEnd(), ...continuationOf(lines, index));
  }
  const body = kept.length > 0 ? kept.join("\n") : lines.slice(0, 30).join("\n");
  return cutToLength(body, maxChars);
}

/** The lines that finish a signature the `export` line left open, at most four. */
function continuationOf(lines: readonly string[], index: number): string[] {
  const line = lines[index] ?? "";
  if (/[;{})=]\s*$/u.test(line) || /\bfrom\b/u.test(line)) return [];
  const out: string[] = [];
  const following = lines.slice(index + 1, index + 5);
  for (const continuation of following) {
    out.push(continuation.trimEnd());
    if (/[;{)]\s*$/u.test(continuation)) break;
  }
  return out;
}

function documentBlockAbove(lines: readonly string[], index: number): string[] {
  const block: string[] = [];
  for (let at = index - 1; at >= 0; at -= 1) {
    const line = (lines[at] ?? "").trimEnd();
    if (line.trim() === "" || !/^\s*(?:\/\*\*|\*|\/\/)/u.test(line)) break;
    block.unshift(line);
    if (line.trimStart().startsWith("/**")) break;
  }
  return block.slice(-JSDOC_LINES_KEPT);
}

// -- related changes ------------------------------------------------------------

/** `src/a/foo.test.ts` -> `foo`; the part of the file name before its first dot. */
function stemOf(path: string): string {
  const name = path.split("/").at(-1) ?? path;
  return name.split(".", 1)[0] ?? name;
}

function directoryOf(path: string): string {
  return path.split("/").slice(0, -1).join("/");
}

/**
 * The other changed files that belong with this one: the same directory, or
 * the same stem anywhere (`foo.ts` beside `foo.test.ts`, `foo.types.ts`).
 * Ordered same-stem first, then by path.
 */
export function relatedChanges(file: ChangedFile, all: readonly ChangedFile[]): ChangedFile[] {
  const stem = stemOf(file.path);
  const directory = directoryOf(file.path);
  const candidates = all.filter(
    (other) =>
      other.path !== file.path &&
      other.patch !== "" &&
      (stemOf(other.path) === stem || directoryOf(other.path) === directory),
  );
  const rank = (other: ChangedFile): number => (stemOf(other.path) === stem ? 0 : 1);
  return candidates.toSorted(
    (a, b) => rank(a) - rank(b) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
  );
}

// -- gathering ------------------------------------------------------------------

export interface GatherContextOptions {
  readonly file: ChangedFile;
  /** Every changed file of the change set, this one included. */
  readonly changeSet: readonly ChangedFile[];
  readonly context: CodeContext;
  readonly limits?: ContextLimits;
  readonly logger?: Logger;
}

/**
 * Everything the review can say about a file's surroundings, within the
 * limits. A port call that fails costs that one item, never the review: the
 * model then judges with less context, as it does today.
 *
 * The two kinds that need the repository are fetched through one bounded
 * pool, so a file's gathering overlaps instead of running one subprocess at a
 * time -- and the results are read back in request order, so what the model
 * sees does not depend on which call happened to answer first.
 */
export async function gatherContext(options: GatherContextOptions): Promise<ReviewContext> {
  const limits = options.limits ?? DEFAULT_CONTEXT_LIMITS;
  if (limits.maxChars <= 0) return EMPTY_CONTEXT;
  const log = (options.logger ?? NULL_LOGGER).child("review.context");
  const { file, context } = options;
  const perItem = Math.max(400, Math.floor(limits.maxChars / 4));
  const lookup = pLimit(MAX_CONCURRENT_LOOKUPS);

  const defined = localImports(file.patch)
    .slice(0, limits.maxDefinitions)
    .map((specifier) =>
      lookup(async (): Promise<DefinitionContext | null> => {
        try {
          const resolved = await resolveModule(file.path, specifier, context);
          return resolved === null
            ? null
            : {
                specifier,
                path: resolved.path,
                signatures: exportSignatures(resolved.text, perItem),
              };
        } catch (error) {
          log.debug(
            `context: could not resolve ${specifier} from ${file.path}: ${errorMessage(error)}`,
          );
          return null;
        }
      }),
    );

  const used = changedExports(file.patch)
    .slice(0, limits.maxSymbols)
    .map((symbol) =>
      lookup(async (): Promise<UsageContext | null> => {
        try {
          const hits = await context.search(symbol, limits.maxUsagesPerSymbol * 4);
          const paths = sortedByCodePoint(
            new Set(hits.map((hit) => hit.path).filter((p) => p !== file.path)),
          );
          return paths.length === 0
            ? null
            : { symbol, paths: paths.slice(0, limits.maxUsagesPerSymbol) };
        } catch (error) {
          log.debug(`context: search for ${symbol} failed: ${errorMessage(error)}`);
          return null;
        }
      }),
    );

  // Definitions are queued first, so when the pool is the binding constraint
  // the more valuable kind is the one that gets fetched.
  const [definitions, usages] = await Promise.all([Promise.all(defined), Promise.all(used)]);

  const related = relatedChanges(file, options.changeSet)
    .slice(0, limits.maxRelated)
    .map((other) => ({ path: other.path, patch: cutToLength(other.patch, perItem) }));

  return {
    definitions: definitions.filter((item) => item !== null),
    usages: usages.filter((item) => item !== null),
    related,
  };
}

// -- rendering ------------------------------------------------------------------

/**
 * The context as one prompt block, most valuable first, cut at `maxChars` on a
 * section boundary where possible. `""` when there is nothing to say.
 */
export function renderContext(context: ReviewContext, maxChars: number): string {
  const sections = [
    section(
      "Definitions of modules this file imports (exported signatures at the head; for understanding only):",
      context.definitions.map((d) => `--- ${d.path} (imported as ${d.specifier})\n${d.signatures}`),
    ),
    section(
      "Other files that mention exported symbols this change touches (a signature change may break them):",
      context.usages.map((u) => `- ${u.symbol}: ${u.paths.join(", ")}`),
    ),
    section(
      "Related files changed in the same change set (their diffs; for understanding only):",
      context.related.map((r) => `--- ${r.path}\n\`\`\`diff\n${r.patch}\n\`\`\``),
    ),
  ].filter((text) => text !== "");
  if (sections.length === 0) return "";
  const out: string[] = [];
  let used = 0;
  for (const section of sections) {
    if (used + section.length > maxChars) {
      if (out.length === 0) out.push(cutToLength(section, maxChars));
      break;
    }
    out.push(section);
    used += section.length + 2;
  }
  return out.join("\n\n");
}

/** A titled section, or `""` when it has no items. */
function section(title: string, items: readonly string[]): string {
  return items.length === 0 ? "" : [title, ...items].join("\n");
}
