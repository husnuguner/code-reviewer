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

// -- what the patch says ------------------------------------------------------

/**
 * A patch's lines by side, markers stripped: what the change wrote, what it removed, and the context
 * git printed around it. Diff and hunk headers belong to none of them.
 */
function patchLines(patch: string): { added: string[]; removed: string[]; kept: string[] } {
  const added: string[] = [];
  const removed: string[] = [];
  const kept: string[] = [];
  for (const line of patch.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) added.push(line.slice(1));
    else if (line.startsWith("-")) removed.push(line.slice(1));
    else if (line.startsWith(" ")) kept.push(line.slice(1));
  }
  return { added, removed, kept };
}

/**
 * An import's module specifier: relative (`./x`, `../x`) or repository-root-relative (`src/x`).
 *
 * @remarks `\s` spans newlines and the lines are matched as one text, so a specifier on a line of its
 * own -- `await import(\n  "./x"\n)`, how a formatter breaks a long dynamic import -- is found too.
 */
const IMPORT_SPECIFIER =
  /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["']((?:\.{1,2}\/|src\/)[^"']+)["']/gu;

/**
 * Specifier prefixes taken as repository-root-relative instead of relative to the importing file: the
 * `baseUrl: "."` spelling (`src/workflows/x`) that Medusa and many TypeScript projects use.
 */
const ROOT_RELATIVE_PREFIXES = ["src/"];

function isRootRelative(specifier: string): boolean {
  return ROOT_RELATIVE_PREFIXES.some((prefix) => specifier.startsWith(prefix));
}

/** Every specifier the lines import, in first-seen order, duplicates included. */
function specifiersIn(lines: readonly string[]): string[] {
  const found: string[] = [];
  for (const match of lines.join("\n").matchAll(IMPORT_SPECIFIER)) {
    const specifier = match[1];
    if (specifier !== undefined) found.push(specifier);
  }
  return found;
}

/**
 * The local modules the patch shows this file importing, each once: the imports the change wrote
 * first, then the ones only the surrounding context lines show.
 *
 * @remarks Package imports are not local and are skipped. Removed lines are not read: an import the
 * change deleted is not one the file has. Context lines are read because a file's dependency is a
 * dependency whether or not this change happened to touch the import line -- but it ranks second, so
 * a cap still keeps what the change touched.
 */
export function localImports(patch: string): string[] {
  const { added, kept } = patchLines(patch);
  return [...new Set([...specifiersIn(added), ...specifiersIn(kept)])];
}

const EXPORTED_SYMBOL =
  /^\s*export\s+(?:default\s+)?(?:async\s+)?(?:const|let|var|function\*?|class|interface|type|enum|abstract\s+class)\s+([A-Za-z_$][\w$]*)/u;

/** Extensions the import resolver understands: an edge is only drawn between two files it can resolve. */
const CODE_EXTENSIONS = new Set(["ts", "tsx", "mts", "cts", "js", "mjs", "cjs", "jsx"]);

/** Whether the import machinery applies to this path at all. */
function isCodePath(path: string): boolean {
  const extension = path.split("/").at(-1)?.split(".").at(-1) ?? "";
  return CODE_EXTENSIONS.has(extension.toLowerCase());
}

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
  const { added, removed } = patchLines(patch);
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
 * Resolves an import specifier to a repository-relative path.
 *
 * @returns e.g. `./x` from `src/a/b.ts` → `src/a/x`; never leaves the root. A root-relative specifier
 * (`src/a/x`) is already the answer and is returned unchanged.
 */
export function resolveSpecifier(fromPath: string, specifier: string): string {
  if (isRootRelative(specifier)) return specifier;
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

/** Declarations whose members _are_ the signature: an enum's values, an interface's fields. */
const MEMBER_DECLARATION = /^\s*export\s+(?:declare\s+)?(?:const\s+)?(?:enum|interface|type)\b/u;

/** Body lines of such a declaration kept before the rest is elided. */
const MEMBER_LINES_KEPT = 16;

/**
 * A module's exported surface: each `export` line with the doc block above it, the members of an
 * `enum`/`interface`/`type` it opens, or the first lines of a module exporting nothing recognisable.
 *
 * @param maxChars - The code-point cap.
 */
export function exportSignatures(text: string, maxChars: number): string {
  const lines = text.split("\n");
  const kept: string[] = [];
  for (const [index, line] of lines.entries()) {
    if (!/^\s*export\b/u.test(line)) continue;
    kept.push(
      ...documentBlockAbove(lines, index),
      line.trimEnd(),
      ...continuationOf(lines, index),
      ...memberBlockOf(lines, index),
    );
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

/** How many times a character occurs in a line. */
function occurrences(text: string, character: string): number {
  let count = 0;
  for (const found of text) if (found === character) count += 1;
  return count;
}

/**
 * The body of a declaration whose members are its signature.
 *
 * @remarks `export enum SubscriptionModules {` on its own names the type and nothing else: the model
 * cannot tell whether the `SubscriptionModules.CORE` in the diff exists. Functions and classes are
 * left out on purpose -- their bodies are implementation, not surface.
 * @returns The body with its closing brace, elided past {@link MEMBER_LINES_KEPT}; `[]` for anything
 * that is not a member declaration opening a block.
 */
function memberBlockOf(lines: readonly string[], index: number): string[] {
  const line = lines[index] ?? "";
  if (!MEMBER_DECLARATION.test(line) || !/\{\s*$/u.test(line)) return [];
  const body: string[] = [];
  let depth = 1;
  const following = lines.slice(index + 1);
  for (const next of following) {
    depth += occurrences(next, "{") - occurrences(next, "}");
    if (depth > 0 && body.length >= MEMBER_LINES_KEPT) {
      body.push("  // ...", "}");
      break;
    }
    body.push(next.trimEnd());
    if (depth <= 0) break;
  }
  return body;
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

/** A path without its extension or a trailing `/index`: two spellings of one module compare equal. */
function moduleKey(path: string): string {
  return withoutExtension(path).replace(/\/index$/u, "");
}

/**
 * `localImports` is asked once per ordered pair of a change set; the answer only depends on the patch,
 * which a {@link ChangedFile} never changes.
 */
const IMPORTS_BY_FILE = new WeakMap<ChangedFile, readonly string[]>();

function importsOf(file: ChangedFile): readonly string[] {
  const memoised = IMPORTS_BY_FILE.get(file);
  if (memoised !== undefined) return memoised;
  const imports = localImports(file.patch);
  IMPORTS_BY_FILE.set(file, imports);
  return imports;
}

/** Whether `from`'s patch shows it importing `path`. */
function hasImportOf(from: ChangedFile, path: string): boolean {
  if (!isCodePath(from.path) || !isCodePath(path)) return false;
  const target = moduleKey(path);
  return importsOf(from).some(
    (specifier) => moduleKey(resolveSpecifier(from.path, specifier)) === target,
  );
}

/**
 * How `other` relates to the file under review.
 *
 * @returns `imports` when the file under review imports it, `imported-by` for the other direction,
 * `sibling` when only the name or the directory connects them.
 */
export function relationTo(file: ChangedFile, other: ChangedFile): RelatedRelation {
  if (hasImportOf(file, other.path)) return "imports";
  return hasImportOf(other, file.path) ? "imported-by" : "sibling";
}

/**
 * The other changed files that belong with this one: bound by an import, or sharing the stem or the
 * directory.
 *
 * @remarks The import edge outranks both name heuristics because it is the relation a change actually
 * breaks -- `api/handler.ts` and the `services/users.ts` it imports share neither stem nor directory,
 * and with a cap of three the siblings of a crowded directory would otherwise crowd the dependency out.
 * @returns Import-bound files first, then the same stem, then the same directory; by path within a rank.
 */
export function relatedChanges(file: ChangedFile, all: readonly ChangedFile[]): ChangedFile[] {
  const stem = stemOf(file.path);
  const directory = directoryOf(file.path);
  const rank = (other: ChangedFile): number =>
    relationTo(file, other) === "sibling" ? (stemOf(other.path) === stem ? 1 : 2) : 0;
  const candidates = all.filter(
    (other) =>
      other.path !== file.path &&
      other.patch !== "" &&
      (rank(other) < 2 || directoryOf(other.path) === directory),
  );
  return candidates.toSorted(
    (a, b) => rank(a) - rank(b) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
  );
}

// -- who uses a changed export ---------------------------------------------------

/**
 * Export names not worth a repository search. Every Medusa route exports `GET` and `POST`, every other
 * module a `default`: the hits are the whole repository rather than this change's users, and the block
 * they fill is the one the cap then spends.
 */
const UNSEARCHABLE_EXPORTS = new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
  "HEAD",
  "default",
  "handler",
  "config",
  "metadata",
  "middlewares",
]);

/** Extensions whose mention of a symbol is prose or generated output, not a call a change can break. */
const NON_SOURCE_EXTENSIONS = new Set([
  "md",
  "mdx",
  "json",
  "yaml",
  "yml",
  "lock",
  "txt",
  "csv",
  "snap",
  "html",
  "xml",
]);

/**
 * Whether a search hit is a file a signature change could break.
 *
 * @remarks Documentation, generated specs and dotfiles mention every symbol and answer nothing; unlike
 * {@link isCodePath} this is a denylist, so a Python or Go repository keeps its usages.
 */
function isUsagePath(path: string): boolean {
  if (path.startsWith(".") || path.includes("/.")) return false;
  const name = path.split("/").at(-1) ?? path;
  const extension = name.includes(".") ? (name.split(".").at(-1) ?? "") : "";
  return !NON_SOURCE_EXTENSIONS.has(extension.toLowerCase());
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

  const defined = (isCodePath(file.path) ? importsOf(file) : [])
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

  const changed = changedExports(file.patch);
  const searchable = changed.filter((symbol) => !UNSEARCHABLE_EXPORTS.has(symbol));
  if (searchable.length < changed.length) {
    const skipped = changed.filter((symbol) => UNSEARCHABLE_EXPORTS.has(symbol));
    log.debug(
      `context ${file.path}: not searched for, every file has them: ${skipped.join(", ")}.`,
    );
  }
  const used = searchable.slice(0, limits.maxSymbols).map((symbol) =>
    lookup(async (): Promise<UsageContext | null> => {
      try {
        const hits = await context.search(symbol, limits.maxUsagesPerSymbol * 4);
        const paths = sortedByCodePoint(
          new Set(hits.map((hit) => hit.path).filter((p) => p !== file.path && isUsagePath(p))),
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
    .map((other) => ({
      path: other.path,
      relation: relationTo(file, other),
      patch: cutToLength(other.patch, perItem),
    }));

  return {
    definitions: definitions.filter((item) => item !== null),
    usages: usages.filter((item) => item !== null),
    related,
  };
}

// -- rendering ------------------------------------------------------------------

/** One block of the rendered context: its heading and the items under it. */
interface Section {
  readonly title: string;
  readonly items: readonly string[];
}

/** The section as it reads whole. */
function sectionText({ title, items }: Section): string {
  return [title, ...items].join("\n");
}

/**
 * How many code points each section may take.
 *
 * @remarks An equal share each, with whatever a section does not need handed on to the ones that do,
 * most valuable first. A first-come budget would let one long block of imported signatures spend the
 * whole allowance and leave the related diffs -- the cheapest answer to "was the counterpart
 * updated?" -- out of the prompt entirely.
 * @returns One allowance per section, summing to at most `budget`.
 */
function allowances(wanted: readonly number[], budget: number): number[] {
  const even = Math.floor(budget / Math.max(1, wanted.length));
  const granted = wanted.map((want) => Math.min(want, even));
  let spare = budget - granted.reduce((sum, value) => sum + value, 0);
  for (const [index, want] of wanted.entries()) {
    const extra = Math.min(want - (granted[index] ?? 0), spare);
    if (extra <= 0) continue;
    granted[index] = (granted[index] ?? 0) + extra;
    spare -= extra;
  }
  return granted;
}

/**
 * As much of a section as its allowance fits, on an item boundary.
 *
 * @returns The section, or `""` when not even its first item fits.
 */
function fitSection(section: Section, allowance: number): string {
  const kept: string[] = [];
  let used = section.title.length;
  for (const item of section.items) {
    if (used + 1 + item.length > allowance) break;
    kept.push(item);
    used += 1 + item.length;
  }
  return kept.length === 0 ? "" : sectionText({ title: section.title, items: kept });
}

/**
 * Renders the context as one prompt block, most valuable first.
 *
 * @param maxChars - The cap on the whole block. Sections share it; within one, items are dropped on
 * their own boundary, and only a first section that cannot fit at all is cut mid-item.
 * @returns The block, or `""` when there is nothing to say.
 */
export function renderContext(context: ReviewContext, maxChars: number): string {
  const sections: Section[] = [
    {
      title:
        "Definitions of modules this file imports (exported signatures at the head; for understanding only):",
      items: context.definitions.map(
        (d) => `--- ${d.path} (imported as ${d.specifier})\n${d.signatures}`,
      ),
    },
    {
      title:
        "Other files that mention exported symbols this change touches (a signature change may break them):",
      items: context.usages.map((u) => `- ${u.symbol}: ${u.paths.join(", ")}`),
    },
    {
      title: "Related files changed in the same change set (their diffs; for understanding only):",
      items: context.related.map(
        (r) => `--- ${r.path}${RELATION_LABEL[r.relation]}\n\`\`\`diff\n${r.patch}\n\`\`\``,
      ),
    },
  ].filter(({ items }) => items.length > 0);
  if (sections.length === 0) return "";
  const separators = 2 * (sections.length - 1);
  const shares = allowances(
    sections.map((entry) => sectionText(entry).length),
    Math.max(0, maxChars - separators),
  );
  const out = sections.flatMap((entry, index) => {
    const text = fitSection(entry, shares[index] ?? 0);
    return text === "" ? [] : [text];
  });
  return out.length === 0
    ? cutToLength(sectionText(sections[0] as Section), maxChars)
    : out.join("\n\n");
}

/** How each relation is announced, so the model knows why it is being shown the diff. */
const RELATION_LABEL: Record<RelatedRelation, string> = {
  imports: " (this file imports it)",
  "imported-by": " (it imports this file)",
  sibling: "",
};
