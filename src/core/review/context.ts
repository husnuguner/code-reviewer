/**
 * Deterministic pre-context fetched before the model is asked: imported modules' signatures, users of
 * changed exports, and related diffs. The model asks nothing; the review stays one call.
 * @packageDocumentation
 */

import pLimit from "p-limit";

import { type ChangedFile } from "../domain/changed-file";
import { type CodeContext } from "../ports/code-context";
import { type Logger, NULL_LOGGER } from "../ports/logger";
import { errorMessage } from "../util/errors";
import { cutToLength, sortedByCodePoint } from "../util/text";

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

/** The built-in limits. */
export const DEFAULT_CONTEXT_LIMITS: ContextLimits = {
  maxChars: 6000,
  maxDefinitions: 4,
  maxSymbols: 6,
  maxUsagesPerSymbol: 8,
  maxRelated: 3,
};

/** Port calls in flight per file; multiplies with `maxConcurrentFiles`. */
const MAX_CONCURRENT_LOOKUPS = 4;

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

/** Another changed file's diff. */
export interface RelatedChange {
  readonly path: string;
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

// -- what the patch says ------------------------------------------------------

/** The added and removed lines of a diff, markers stripped. */
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
 * Relative module specifiers the added lines import, each once, in first-seen order.
 *
 * @remarks Package imports are not local and are skipped.
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
 * Names whose `export` declaration the patch adds, removes or edits, most worth asking about first.
 *
 * @returns Edited signatures (on both sides) first, then new or deleted exports; alphabetical within a rank.
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

/**
 * Resolves a relative specifier against the importing file's directory.
 *
 * @returns e.g. `./x` from `src/a/b.ts` → `src/a/x`; never leaves the root.
 */
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

/** Strips a `.js`/`.ts`-style extension. */
function withoutExtension(path: string): string {
  return path.replace(/\.(?:[cm]?[jt]sx?)$/u, "");
}

/** The first candidate file the module resolves to at the ref, with its text, or `null`. */
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
 * A module's exported surface: each `export` line with the doc block above it, or the first lines of
 * a module exporting nothing recognisable.
 *
 * @param maxChars - The code-point cap.
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

/** Up to four lines finishing a signature the `export` line left open. */
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

/** The file name before its first dot: `src/a/foo.test.ts` → `foo`. */
function stemOf(path: string): string {
  const name = path.split("/").at(-1) ?? path;
  return name.split(".", 1)[0] ?? name;
}

function directoryOf(path: string): string {
  return path.split("/").slice(0, -1).join("/");
}

/**
 * The other changed files that belong with this one: same directory, or same stem anywhere.
 *
 * @returns Same-stem files first, then by path.
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

/** Input to {@link gatherContext}. */
export interface GatherContextOptions {
  readonly file: ChangedFile;
  /** Every changed file of the change set, this one included. */
  readonly changeSet: readonly ChangedFile[];
  readonly context: CodeContext;
  readonly limits?: ContextLimits;
  readonly logger?: Logger;
}

/**
 * Gathers a file's surroundings within the limits.
 *
 * @returns The context. A port call that fails costs that one item, never the review. Results are read
 * back in request order, so the prompt does not depend on which call answered first.
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

  // Definitions are queued first: when the pool binds, the more valuable kind is fetched.
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
 * Renders the context as one prompt block, most valuable first.
 *
 * @param maxChars - Cut on a section boundary where possible.
 * @returns The block, or `""` when there is nothing to say.
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
