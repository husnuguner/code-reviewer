/**
 * The `typescript` language: how TypeScript and JavaScript write imports and exports, and how a module
 * reads as a surface. Pure syntax, pinned here; the pre-context algorithm that asks these questions is
 * `tests/core/review/context.test.ts`'s.
 */

import { describe, expect, it } from "bun:test";

import { ChangedFile } from "../../../src/core/domain/changed-file";
import { type CodeContext, type CodeSearchHit } from "../../../src/core/ports/code-context";
import { changedSymbols, gatherContext, patchSides } from "../../../src/core/review/context/index";
import { builtinLanguages } from "../../../src/providers/languages/builtin";
import { TypeScriptLanguage } from "../../../src/providers/languages/typescript/language";

const TS = new TypeScriptLanguage();

/** The path a specifier names from a file, as the language resolves it. */
function resolvedPath(fromPath: string, specifier: string): string {
  return TS.resolve(fromPath, specifier).path;
}

const PATCH = [
  "@@ -1,4 +1,6 @@",
  ' import { helper } from "./util/helper";',
  '+import { Service } from "../services/service";',
  "+import type { Dto } from './types.js';",
  '+const lazy = await import("./lazy");',
  "-export function total(items: Item[]): number {",
  "+export function total(items: Item[], tax: number): number {",
  "+export const RATE = 3;",
  "   return 1;",
].join("\n");

/** A repository of a few files, in memory. */
function fakeContext(files: Record<string, string>): CodeContext {
  return {
    readFile: (path) => Promise.resolve(files[path] ?? null),
    search: (needle, limit) => {
      const hits: CodeSearchHit[] = [];
      for (const [path, text] of Object.entries(files)) {
        for (const [index, line] of text.split("\n").entries()) {
          if (line.includes(needle)) hits.push({ path, line: index + 1, text: line });
        }
      }
      return Promise.resolve(hits.slice(0, limit));
    },
  };
}

describe("what the patch says", () => {
  it("lists the local modules the patch imports, the ones it touched first", () => {
    // `./util/helper` is on a context line: a dependency all the same, but it
    // ranks behind the three the change wrote, so a cap keeps what was touched.
    expect(TS.imports(patchSides(PATCH))).toEqual([
      "../services/service",
      "./types.js",
      "./lazy",
      "./util/helper",
    ]);
  });

  it("ignores package imports and imports the change removed", () => {
    expect(TS.imports(patchSides('+import x from "zod";\n import y from "./ctx";'))).toEqual([
      "./ctx",
    ]);
    expect(TS.imports(patchSides('-import gone from "./gone";'))).toEqual([]);
  });

  /**
   * A formatter breaks a long dynamic import across lines, and Medusa-style
   * projects import from the repository root. Both were invisible while the
   * scan was line-by-line and relative-only.
   */
  it("reads a specifier on its own line and a root-relative one", () => {
    const patch = [
      "+    const { run } = await import(",
      "+      '../../workflows/cancel.workflow.js'",
      "+    );",
      "+import { helper } from 'src/common/helper';",
    ].join("\n");
    expect(TS.imports(patchSides(patch))).toEqual([
      "../../workflows/cancel.workflow.js",
      "src/common/helper",
    ]);
  });

  it("names the exports the patch adds, removes or edits", () => {
    // `total` is on both sides (an edited signature, the case that breaks
    // callers), so it outranks the added-only `RATE` despite the alphabet.
    expect(changedSymbols(patchSides(PATCH), TS)).toEqual(["total", "RATE"]);
    expect(
      changedSymbols(patchSides("+export default class Foo {}\n+export abstract class Bar {}"), TS),
    ).toEqual(["Bar", "Foo"]);
  });

  it("ranks edited signatures before new or deleted exports, alphabetically within a rank", () => {
    const patch = [
      "+export function apply(a: number): void {",
      "-export function apply(): void {",
      "+export const zeta = 1;",
      "-export class Gone {}",
      "+export interface Added {}",
      "-export type Edited = 2;",
      "+export type Edited = 3;",
    ].join("\n");
    expect(changedSymbols(patchSides(patch), TS)).toEqual([
      "Edited",
      "apply",
      "Added",
      "Gone",
      "zeta",
    ]);
  });

  it("resolves a specifier against the importing file, never above the root", () => {
    expect(resolvedPath("src/a/b.ts", "./x")).toBe("src/a/x");
    expect(resolvedPath("src/a/b.ts", "../services/service")).toBe("src/services/service");
    expect(resolvedPath("a.ts", "../../x")).toBe("x");
  });

  /** Every extension an edge may be drawn to is one a definition can be read from. */
  it("resolves the CommonJS spellings the import graph accepts", async () => {
    const file = new ChangedFile(
      "src/a.ts",
      "modified",
      '+import { x } from "./legacy.cjs";\n+import { y } from "./typed.cts";',
    );
    const context = await gatherContext({
      file,
      changeSet: [file],
      context: fakeContext({
        "src/legacy.cjs": "module.exports = { x: 1 };\nexport const x = 1;\n",
        "src/typed.cts": "export const y = 2;\n",
      }),
      languages: builtinLanguages(),
    });
    expect(context.definitions.map((d) => d.path)).toEqual(["src/legacy.cjs", "src/typed.cts"]);
  });

  it("leaves a root-relative specifier alone", () => {
    expect(resolvedPath("src/api/deep/route.ts", "src/common/helper")).toBe("src/common/helper");
  });
});

describe("what the repository says", () => {
  const MODULE = [
    "import { z } from 'zod';",
    "",
    "/**",
    " * Charges the customer.",
    " * @param amount in cents",
    " */",
    "export async function charge(",
    "  customer: string,",
    "  amount: number,",
    "): Promise<Receipt> {",
    "  return run(customer, amount);",
    "}",
    "",
    "function run() {}",
    "export const LIMIT = 10;",
    "export { helper } from './helper';",
  ].join("\n");

  it("keeps export lines, their doc block and an open signature's continuation", () => {
    const signatures = TS.signatures(MODULE, 10_000);
    expect(signatures).toContain("* Charges the customer.");
    expect(signatures).toContain("export async function charge(");
    expect(signatures).toContain("): Promise<Receipt> {");
    expect(signatures).toContain("export const LIMIT = 10;");
    expect(signatures).toContain("export { helper } from './helper';");
    expect(signatures).not.toContain("return run(customer, amount);");
    expect(signatures).not.toContain("function run() {}");
  });

  /**
   * The name of an enum answers nothing: the caller writes `Modules.CORE` and
   * the question is whether `CORE` is there.
   */
  it("keeps the members of an enum, an interface and a type, with the closing brace", () => {
    const module = [
      "export enum Modules {",
      "  PLAN = 'planModule',",
      "  CORE = 'coreModule',",
      "}",
      "export interface Options {",
      "  id: string;",
      "}",
      "export class Service {",
      "  private secret = 1;",
      "}",
    ].join("\n");
    const signatures = TS.signatures(module, 10_000);
    expect(signatures).toContain("  CORE = 'coreModule',");
    expect(signatures).toContain("  id: string;");
    // A class body is implementation, not surface.
    expect(signatures).not.toContain("private secret");
  });

  /**
   * A brace inside a value is not structure. Counted as one, `OPEN = '{'` kept
   * the block open until the line cap elided it -- the members were there, but
   * followed by a false `// ...` and a brace that closed nothing.
   */
  it("does not mistake a brace in a string for the block's", () => {
    const module = [
      "export enum Marker {",
      "  OPEN = '{',",
      '  CLOSE = "}",',
      "  TICK = `${x}`,",
      "}",
      "export const after = 1;",
    ].join("\n");
    const signatures = TS.signatures(module, 10_000);
    expect(signatures).toContain("  OPEN = '{',");
    expect(signatures).toContain('  CLOSE = "}",');
    expect(signatures).not.toContain("// ...");
    // The block closed where it should, so the next export follows it once.
    expect(signatures.split("export const after = 1;")).toHaveLength(2);
  });

  /** The `{` may sit on the last line of a wrapped signature, not the `export` line. */
  it("reads the members of a declaration whose head wraps onto more lines", () => {
    const module = ["export interface Long<", "  T,", "> {", "  a: T;", "}"].join("\n");
    const signatures = TS.signatures(module, 10_000);
    expect(signatures).toContain("> {");
    expect(signatures).toContain("  a: T;");
    expect(signatures.trimEnd().endsWith("}")).toBe(true);
  });

  it("elides a member block longer than the cap instead of running on", () => {
    const long = [
      "export enum Big {",
      ...Array.from({ length: 40 }, (_, index) => `  K${index} = '${index}',`),
      "}",
    ].join("\n");
    const signatures = TS.signatures(long, 10_000);
    expect(signatures).toContain("  K15 = '15',");
    expect(signatures).not.toContain("  K16 = '16',");
    expect(signatures).toContain("  // ...");
    expect(signatures.trimEnd().endsWith("}")).toBe(true);
  });

  it("falls back to the head of a module that exports nothing recognisable, and caps", () => {
    const text = Array.from({ length: 50 }, (_, index) => `line ${index}`).join("\n");
    const head = TS.signatures(text, 10_000);
    expect(head.startsWith("line 0\n")).toBe(true);
    expect(head.split("\n")).toHaveLength(30);
    expect(TS.signatures(text, 12)).toHaveLength(12);
  });
});

describe("the language as a whole", () => {
  it("reads TypeScript and JavaScript in every module flavour, and nothing else", () => {
    expect(TS.id).toBe("typescript");
    expect([...TS.extensions].toSorted((a, b) => a.localeCompare(b))).toEqual([
      "cjs",
      "cts",
      "js",
      "jsx",
      "mjs",
      "mts",
      "ts",
      "tsx",
    ]);
  });

  it("offers only source files as candidates, the importing file's spelling first", () => {
    const target = TS.resolve("src/api/route.ts", "./helpers.js");
    expect(target.path).toBe("src/api/helpers.js");
    expect(target.key).toBe("src/api/helpers");
    expect(target.candidates.slice(0, 3)).toEqual([
      "src/api/helpers.js",
      "src/api/helpers.js.ts",
      "src/api/helpers.js.tsx",
    ]);
    expect(target.candidates).toContain("src/api/helpers.ts");
    // A specifier naming a non-source file has nothing to read, whatever suffix is tried.
    expect(TS.resolve("src/app.ts", "../.env").candidates.every((path) => path !== ".env")).toBe(
      true,
    );
    expect(TS.resolve("src/app.ts", "./data.json").candidates).not.toContain("src/data.json");
  });

  it("gives one module one key, however it is spelled", () => {
    expect(TS.moduleKey("src/a/index.ts")).toBe("src/a");
    expect(TS.moduleKey("src/a.tsx")).toBe("src/a");
    expect(TS.resolve("src/b.ts", "./a").key).toBe("src/a");
  });

  it("takes the root-relative prefixes it is configured with", () => {
    const aliased = new TypeScriptLanguage({ rootRelativePrefixes: ["app/", "lib/"] });
    const sides = patchSides("+import { a } from 'app/core/a';\n+import { b } from 'src/b';");
    expect(aliased.imports(sides)).toEqual(["app/core/a"]);
    expect(aliased.resolve("deep/x/y.ts", "app/core/a").path).toBe("app/core/a");
  });

  it("does not search for the names every route and module exports", () => {
    for (const name of ["GET", "POST", "default", "middlewares"]) {
      expect(TS.unsearchableSymbols.has(name)).toBe(true);
    }
    expect(TS.unsearchableSymbols.has("findUser")).toBe(false);
  });

  it("names files the JavaScript way: the stem is the name before its first dot", () => {
    expect(TS.stemOf("src/users/service.test.ts")).toBe("service");
    expect(TS.isPossibleUser("src/jobs/sync.ts")).toBe(true);
    expect(TS.isPossibleUser("docs/api.md")).toBe(false);
  });
});
