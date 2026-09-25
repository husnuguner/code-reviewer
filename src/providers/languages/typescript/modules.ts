/**
 * How a TypeScript/JavaScript specifier becomes files: relative to the importing file or to the repository
 * root, tried with each extension the module system accepts, and as a directory's `index`.
 * @packageDocumentation
 */

import { type ModuleTarget } from "../../../core/ports/language";
import { extensionOf, joinRelative } from "../../../core/review/context/paths";

/** Extensions this language reads: an import edge is only drawn between two files it can resolve. */
export const CODE_EXTENSIONS: readonly string[] = [
  "ts",
  "tsx",
  "mts",
  "cts",
  "js",
  "mjs",
  "cjs",
  "jsx",
];

const CODE_EXTENSION_SET: ReadonlySet<string> = new Set(CODE_EXTENSIONS);

/**
 * What a specifier may resolve to, tried in order. Every extension in {@link CODE_EXTENSIONS} is here: a
 * file the import graph draws an edge to must be one Definitions can read.
 */
const MODULE_SUFFIXES: readonly string[] = [
  "",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".mjs",
  ".cjs",
  ".jsx",
  "/index.ts",
  "/index.tsx",
  "/index.js",
];

/** Whether this language reads the file at `path`. */
export function isCodePath(path: string): boolean {
  return CODE_EXTENSION_SET.has(extensionOf(path));
}

/** Strips a `.js`/`.ts`-style extension. */
export function withoutExtension(path: string): string {
  return path.replace(/\.(?:[cm]?[jt]sx?)$/u, "");
}

/** A path without its extension or a trailing `/index`: two spellings of one module compare equal. */
export function moduleKey(path: string): string {
  return withoutExtension(path).replace(/\/index$/u, "");
}

/**
 * The repository-relative path a specifier names.
 *
 * @returns e.g. `./x` from `src/a/b.ts` → `src/a/x`; never leaves the root. A root-relative specifier
 * (`src/a/x`) is already the answer and is returned unchanged.
 */
export function resolveSpecifier(
  fromPath: string,
  specifier: string,
  rootPrefixes: readonly string[],
): string {
  return rootPrefixes.some((prefix) => specifier.startsWith(prefix))
    ? specifier
    : joinRelative(fromPath, specifier);
}

/**
 * Where a specifier points: its path, the files to try in order, and its module key.
 *
 * @remarks Only a source file is a module whose signatures mean anything, so a specifier naming anything
 * else (`../.env`, `./data.json`, `./cert.pem`) has no candidate to read.
 */
export function moduleTarget(
  fromPath: string,
  specifier: string,
  rootPrefixes: readonly string[],
): ModuleTarget {
  const path = resolveSpecifier(fromPath, specifier, rootPrefixes);
  const bases = path === withoutExtension(path) ? [path] : [path, withoutExtension(path)];
  const candidates = bases
    .flatMap((base) => MODULE_SUFFIXES.map((suffix) => `${base}${suffix}`))
    .filter((candidate) => isCodePath(candidate));
  return { path, candidates, key: moduleKey(path) };
}
