/**
 * Deterministic pre-context: what the patch says, what the repository says,
 * how it is rendered and capped. The port is faked; the git adapter has its
 * own test.
 */

import { describe, expect, it } from "bun:test";

import { ChangedFile } from "../../../src/core/domain/changed-file";
import { type CodeContext, type CodeSearchHit } from "../../../src/core/ports/code-context";
import {
  DEFAULT_CONTEXT_LIMITS,
  EMPTY_CONTEXT,
  changedExports,
  exportSignatures,
  gatherContext,
  localImports,
  relatedChanges,
  renderContext,
  resolveSpecifier,
} from "../../../src/core/review/context";
import { buildUserPrompt } from "../../../src/core/review/prompts";

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

/**
 * A context that never answers before the next tick and records what was
 * asked and how much was in flight -- the two things the pool is about.
 */
function recordingContext(): {
  context: CodeContext;
  searched: string[];
  peakInFlight: () => number;
} {
  const searched: string[] = [];
  let inFlight = 0;
  let peak = 0;
  const answer = async <T>(value: T): Promise<T> => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 1));
    inFlight -= 1;
    return value;
  };
  return {
    context: {
      readFile: (path) => answer(path.endsWith(".ts") ? `export const x = 1; // ${path}` : null),
      search: (needle) => {
        searched.push(needle);
        return answer([{ path: `users/${needle}.ts`, line: 1, text: needle }]);
      },
    },
    searched,
    peakInFlight: () => peak,
  };
}

describe("what the patch says", () => {
  it("lists the local modules the added lines import, once each", () => {
    expect(localImports(PATCH)).toEqual(["../services/service", "./types.js", "./lazy"]);
  });

  it("ignores package imports and context lines", () => {
    expect(localImports('+import x from "zod";\n import y from "./ctx";')).toEqual([]);
  });

  it("names the exports the patch adds, removes or edits", () => {
    // `total` is on both sides (an edited signature, the case that breaks
    // callers), so it outranks the added-only `RATE` despite the alphabet.
    expect(changedExports(PATCH)).toEqual(["total", "RATE"]);
    expect(changedExports("+export default class Foo {}\n+export abstract class Bar {}")).toEqual([
      "Bar",
      "Foo",
    ]);
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
    expect(changedExports(patch)).toEqual(["Edited", "apply", "Added", "Gone", "zeta"]);
  });

  it("resolves a specifier against the importing file, never above the root", () => {
    expect(resolveSpecifier("src/a/b.ts", "./x")).toBe("src/a/x");
    expect(resolveSpecifier("src/a/b.ts", "../services/service")).toBe("src/services/service");
    expect(resolveSpecifier("a.ts", "../../x")).toBe("x");
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
    const signatures = exportSignatures(MODULE, 10_000);
    expect(signatures).toContain("* Charges the customer.");
    expect(signatures).toContain("export async function charge(");
    expect(signatures).toContain("): Promise<Receipt> {");
    expect(signatures).toContain("export const LIMIT = 10;");
    expect(signatures).toContain("export { helper } from './helper';");
    expect(signatures).not.toContain("return run(customer, amount);");
    expect(signatures).not.toContain("function run() {}");
  });

  it("falls back to the head of a module that exports nothing recognisable, and caps", () => {
    const text = Array.from({ length: 50 }, (_, index) => `line ${index}`).join("\n");
    const head = exportSignatures(text, 10_000);
    expect(head.startsWith("line 0\n")).toBe(true);
    expect(head.split("\n")).toHaveLength(30);
    expect(exportSignatures(text, 12)).toHaveLength(12);
  });
});

/** A modified file with a one-line patch, for the related-change tests. */
function modified(path: string, patch = "+x"): ChangedFile {
  return new ChangedFile(path, "modified", patch);
}

describe("related changes", () => {
  const route = modified("src/api/admin/route.ts");
  const all = [
    route,
    modified("src/api/admin/validation-schemas.ts"),
    modified("src/api/admin/route.test.ts"),
    modified("src/other/route.spec.ts"),
    modified("src/unrelated/thing.ts"),
    modified("src/api/admin/empty.ts", ""),
  ];

  it("picks the same stem first, then the same directory, and skips the file itself", () => {
    expect(relatedChanges(route, all).map((f) => f.path)).toEqual([
      "src/api/admin/route.test.ts",
      "src/other/route.spec.ts",
      "src/api/admin/validation-schemas.ts",
    ]);
  });
});

describe("gathering", () => {
  const file = new ChangedFile("src/api/route.ts", "modified", PATCH);
  const repo = {
    "src/services/service.ts": "/** The service. */\nexport class Service {}\n",
    "src/api/types.ts": "export type Dto = { id: string };\n",
    "src/api/lazy/index.ts": "export const lazy = 1;\n",
    "src/jobs/nightly.ts": "import { total } from '../api/route';\ntotal([]);\n",
    "src/api/route.ts": "export function total() {}\n",
  };

  it("resolves imports to files, lists users of changed exports, adds related diffs", async () => {
    const sibling = new ChangedFile("src/api/route.test.ts", "modified", "+it()");
    const context = await gatherContext({
      file,
      changeSet: [file, sibling],
      context: fakeContext(repo),
    });
    expect(context.definitions.map((d) => [d.specifier, d.path])).toEqual([
      ["../services/service", "src/services/service.ts"],
      ["./types.js", "src/api/types.ts"],
      ["./lazy", "src/api/lazy/index.ts"],
    ]);
    expect(context.definitions[0]?.signatures).toBe("/** The service. */\nexport class Service {}");
    // The file's own mention of `total` is not a "user".
    expect(context.usages).toEqual([{ symbol: "total", paths: ["src/jobs/nightly.ts"] }]);
    expect(context.related).toEqual([{ path: "src/api/route.test.ts", patch: "+it()" }]);
  });

  it("gathers nothing when switched off, and survives a failing port", async () => {
    const off = await gatherContext({
      file,
      changeSet: [file],
      context: fakeContext(repo),
      limits: { ...DEFAULT_CONTEXT_LIMITS, maxChars: 0 },
    });
    expect(off).toBe(EMPTY_CONTEXT);
    const broken: CodeContext = {
      readFile: () => Promise.reject(new Error("offline")),
      search: () => Promise.reject(new Error("offline")),
    };
    const degraded = await gatherContext({ file, changeSet: [file], context: broken });
    expect(degraded).toEqual(EMPTY_CONTEXT);
  });

  it("respects the per-kind limits", async () => {
    const context = await gatherContext({
      file,
      changeSet: [file],
      context: fakeContext(repo),
      limits: {
        maxChars: 6000,
        maxDefinitions: 1,
        maxSymbols: 6,
        maxUsagesPerSymbol: 8,
        maxRelated: 3,
      },
    });
    expect(context.definitions).toHaveLength(1);
  });

  /**
   * The searches are one repository search each, and the rendered block is
   * capped: a file that rewrites its whole export surface must not spend a
   * search per symbol on a section the cap may drop whole.
   */
  it("searches at most maxSymbols of the changed exports, the highest-ranked first", async () => {
    const many = new ChangedFile(
      "src/api/route.ts",
      "modified",
      [
        "-export function edited(): void {",
        "+export function edited(a: number): void {",
        ...Array.from({ length: 30 }, (_, index) => `+export const added${index} = ${index};`),
      ].join("\n"),
    );
    const { context, searched } = recordingContext();
    const gathered = await gatherContext({
      file: many,
      changeSet: [many],
      context,
      limits: { ...DEFAULT_CONTEXT_LIMITS, maxSymbols: 3 },
    });
    expect(searched).toHaveLength(3);
    expect(searched[0]).toBe("edited");
    expect(gathered.usages.map((usage) => usage.symbol)).toEqual(searched);
  });

  it("overlaps its port calls but keeps the pool bounded and the order stable", async () => {
    const patch = [
      ...Array.from({ length: 6 }, (_, index) => `+import { a } from "./mod${index}";`),
      ...Array.from({ length: 6 }, (_, index) => `+export const sym${index} = ${index};`),
    ].join("\n");
    const wide = new ChangedFile("src/api/route.ts", "modified", patch);
    const { context, peakInFlight } = recordingContext();
    const gathered = await gatherContext({
      file: wide,
      changeSet: [wide],
      context,
      limits: { ...DEFAULT_CONTEXT_LIMITS, maxDefinitions: 6, maxSymbols: 6 },
    });
    expect(peakInFlight()).toBeGreaterThan(1);
    expect(peakInFlight()).toBeLessThanOrEqual(4);
    // Request order, not answer order: the block must not shuffle per run.
    expect(gathered.definitions.map((d) => d.specifier)).toEqual([
      "./mod0",
      "./mod1",
      "./mod2",
      "./mod3",
      "./mod4",
      "./mod5",
    ]);
    expect(gathered.usages.map((u) => u.symbol)).toEqual([
      "sym0",
      "sym1",
      "sym2",
      "sym3",
      "sym4",
      "sym5",
    ]);
  });
});

describe("rendering", () => {
  const context = {
    definitions: [{ specifier: "./s", path: "src/s.ts", signatures: "export const s = 1;" }],
    usages: [{ symbol: "total", paths: ["a.ts", "b.ts"] }],
    related: [{ path: "src/r.ts", patch: "+r" }],
  };

  it("orders definitions, usages, related and fences the diffs", () => {
    const text = renderContext(context, 10_000);
    const at = (needle: string): number => text.indexOf(needle);
    expect(at("Definitions of modules")).toBeLessThan(at("Other files that mention"));
    expect(at("Other files that mention")).toBeLessThan(at("Related files changed"));
    expect(text).toContain("--- src/s.ts (imported as ./s)\nexport const s = 1;");
    expect(text).toContain("- total: a.ts, b.ts");
    expect(text).toContain("--- src/r.ts\n```diff\n+r\n```");
  });

  it("drops whole sections past the cap, cutting only when the first would not fit", () => {
    const first = renderContext(context, 130);
    expect(first).toContain("Definitions of modules");
    expect(first).not.toContain("Related files changed");
    expect(renderContext(context, 20)).toHaveLength(20);
    expect(renderContext(EMPTY_CONTEXT, 10_000)).toBe("");
  });

  it("lands in the user prompt between the file content and the skills", () => {
    const prompt = buildUserPrompt({
      path: "a.ts",
      annotatedPatch: "+x",
      allowedLines: [1],
      content: "whole file",
      skillsText: "## skill",
      contextText: "CONTEXT BLOCK",
    });
    const at = (needle: string): number => prompt.indexOf(needle);
    expect(at("whole file")).toBeLessThan(at("CONTEXT BLOCK"));
    expect(at("CONTEXT BLOCK")).toBeLessThan(at("## skill"));
    expect(
      buildUserPrompt({ path: "a", annotatedPatch: "+x", allowedLines: [1], content: null }),
    ).not.toContain("CONTEXT");
  });
});
