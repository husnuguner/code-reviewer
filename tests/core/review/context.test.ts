/**
 * Deterministic pre-context: what the patch says, what the repository says,
 * how it is rendered and capped. The port is faked; the git adapter has its
 * own test.
 */

import { describe, expect, it } from "bun:test";

import { ChangedFile } from "../../../src/core/domain/changed-file";
import { type CodeContext, type CodeSearchHit } from "../../../src/core/ports/code-context";
import { type ModuleTarget, type PatchSides } from "../../../src/core/ports/language";
import {
  DEFAULT_CONTEXT_LIMITS,
  EMPTY_CONTEXT,
  type ReviewContext,
  gatherContext,
  joinRelative,
  relatedChanges,
  relationTo,
  renderContext,
} from "../../../src/core/review/context/index";
import { buildUserPrompt } from "../../../src/core/review/prompts";
import {
  DEFAULT_FILE_REVIEW_SETTINGS,
  contextLimitsOf,
} from "../../../src/core/review/review-file";
import { BUILTIN_LANGUAGES, builtinLanguages } from "../../../src/providers/languages/builtin";
import { Language } from "../../../src/providers/languages/language";
import { LanguageRegistry } from "../../../src/providers/languages/registry";

/** The languages a run knows; pre-context reads TypeScript through them. */
const LANGUAGES = builtinLanguages();

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

/** Filler of a given length, for the budget tests. */
function long(size: number): string {
  return "x".repeat(size);
}

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
    expect(relatedChanges(route, all, LANGUAGES).map((f) => f.path)).toEqual([
      "src/api/admin/route.test.ts",
      "src/other/route.spec.ts",
      "src/api/admin/validation-schemas.ts",
    ]);
  });

  /**
   * The relation a change breaks: neither stem nor directory connects a route
   * to the service it calls, and with a cap of three the siblings of a crowded
   * directory would push the dependency out of the prompt.
   */
  it("ranks an imported and an importing file above the name heuristics", () => {
    const handler = modified("src/api/handler.ts", '+import { users } from "../services/users";');
    const service = modified("src/services/users.ts");
    const caller = modified("src/jobs/nightly.ts", '+import { GET } from "../api/handler";');
    const set = [
      handler,
      modified("src/api/handler.test.ts"),
      modified("src/api/other.ts"),
      service,
      caller,
    ];
    expect(relatedChanges(handler, set, LANGUAGES).map((f) => f.path)).toEqual([
      "src/jobs/nightly.ts",
      "src/services/users.ts",
      "src/api/handler.test.ts",
      "src/api/other.ts",
    ]);
    expect(relationTo(handler, service, LANGUAGES)).toBe("imports");
    expect(relationTo(handler, caller, LANGUAGES)).toBe("imported-by");
    expect(relationTo(handler, modified("src/api/other.ts"), LANGUAGES)).toBe("sibling");
  });

  it("draws an edge through a root-relative specifier and an index module", () => {
    const deep = modified(
      "src/api/store/orders/[id]/route.ts",
      "+import { Modules } from 'src/modules/subscription';\n+import { x } from 'src/common/helper';",
    );
    const barrel = modified("src/modules/subscription/index.ts");
    const helper = modified("src/common/helper.ts");
    expect(relatedChanges(deep, [deep, barrel, helper], LANGUAGES).map((f) => f.path)).toEqual([
      "src/common/helper.ts",
      "src/modules/subscription/index.ts",
    ]);
  });

  /** A markdown file quoting `from "./x"` in a fenced block is not an importer. */
  it("draws no edge to or from a file the resolver does not understand", () => {
    const document = modified("docs/design.md", '+see `import { a } from "../src/a"`');
    const code = modified("src/a.ts");
    expect(relationTo(document, code, LANGUAGES)).toBe("sibling");
    expect(relatedChanges(document, [document, code], LANGUAGES)).toEqual([]);
  });
});

describe("the configured budget", () => {
  /**
   * Two spellings of one default: the constant a direct caller of
   * `gatherContext` gets, and the settings a run reads from its config files.
   */
  it("is the same whether it comes from the constant or from the settings", () => {
    expect(contextLimitsOf(DEFAULT_FILE_REVIEW_SETTINGS)).toEqual(DEFAULT_CONTEXT_LIMITS);
  });

  it("carries every limit from the settings, not just the cap", () => {
    expect(
      contextLimitsOf({
        ...DEFAULT_FILE_REVIEW_SETTINGS,
        maxContextChars: 20_000,
        maxDefinitions: 8,
        maxSymbols: 2,
        maxUsagesPerSymbol: 1,
        maxRelated: 6,
      }),
    ).toEqual({
      maxChars: 20_000,
      maxDefinitions: 8,
      maxSymbols: 2,
      maxUsagesPerSymbol: 1,
      maxRelated: 6,
    });
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
      languages: LANGUAGES,
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
    expect(context.related).toEqual([
      { path: "src/api/route.test.ts", relation: "sibling", patch: "+it()" },
    ]);
  });

  it("never reads a credential file, whatever the patch imports", async () => {
    // Selection keeps credential files out of the change set; pre-context reads beyond it, and an
    // import of `../.env` used to put the file's first lines in the prompt as a "definition".
    const asked: string[] = [];
    const secrets = fakeContext({
      ".env": "DATABASE_PASSWORD=super-secret\n",
      "src/cert.pem": "-----BEGIN PRIVATE KEY-----\n",
      "src/data.json": '{ "token": "t" }\n',
    });
    const recording: CodeContext = {
      readFile: (path) => {
        asked.push(path);
        return secrets.readFile(path);
      },
      search: (needle, limit) => secrets.search(needle, limit),
    };
    const leaky = new ChangedFile(
      "src/app.ts",
      "modified",
      '@@ -1 +1,4 @@\n+const cfg = require("../.env");\n+import key from "./cert.pem";\n+import data from "./data.json";\n export {};',
    );
    const context = await gatherContext({
      languages: LANGUAGES,
      file: leaky,
      changeSet: [leaky],
      context: recording,
    });
    expect(context.definitions).toEqual([]);
    expect(asked).not.toContain(".env");
    expect(asked).not.toContain("src/cert.pem");
    expect(asked).not.toContain("src/data.json");
  });

  it("gives a credential import, or one that resolves to nothing, no Definitions slot", async () => {
    // Found on dfs-backend: `require('../.env')` took one of four slots, and a real module imported
    // further down the file was left out of the block.
    const importing = new ChangedFile(
      "src/api/route.ts",
      "modified",
      [
        "@@ -1 +1,6 @@",
        "+const env = require('../.env');",
        "+import { gone } from './deleted-module';",
        "+import { a } from './a';",
        "+import { b } from './b';",
        "+import { c } from './c';",
        " import { d } from './d';",
      ].join("\n"),
    );
    const context = await gatherContext({
      languages: LANGUAGES,
      file: importing,
      changeSet: [importing],
      context: fakeContext({
        ".env": "SECRET=x\n",
        "src/api/a.ts": "export const a = 1;\n",
        "src/api/b.ts": "export const b = 1;\n",
        "src/api/c.ts": "export const c = 1;\n",
        "src/api/d.ts": "export const d = 1;\n",
      }),
      limits: { ...DEFAULT_CONTEXT_LIMITS, maxDefinitions: 4 },
    });
    expect(context.definitions.map((definition) => definition.path)).toEqual([
      "src/api/a.ts",
      "src/api/b.ts",
      "src/api/c.ts",
      "src/api/d.ts",
    ]);
  });

  it("never lists a credential file among a changed export's users", async () => {
    const exporting = new ChangedFile("src/rate.ts", "modified", "+export const RATE = 3;");
    const context = await gatherContext({
      languages: LANGUAGES,
      file: exporting,
      changeSet: [exporting],
      context: fakeContext({
        "src/use.ts": "RATE;\n",
        "config/prod.key": "RATE\n",
      }),
    });
    expect(context.usages).toEqual([{ symbol: "RATE", paths: ["src/use.ts"] }]);
  });

  /**
   * Every Medusa route exports `GET` and `POST`, so the needle matches the whole
   * repository: two searches spent to fill the block with prose.
   */
  it("does not search for an export name every file has", async () => {
    const route = new ChangedFile(
      "src/api/store/thing/route.ts",
      "added",
      "+export const GET = async () => {};\n+export const POST = async () => {};\n+export const parseFilters = () => {};",
    );
    const { context, searched } = recordingContext();
    const gathered = await gatherContext({
      languages: LANGUAGES,
      file: route,
      changeSet: [route],
      context,
    });
    expect(searched).toEqual(["parseFilters"]);
    expect(gathered.usages.map((usage) => usage.symbol)).toEqual(["parseFilters"]);
  });

  it("keeps only the users a signature change could break", async () => {
    const file = new ChangedFile(
      "src/common/status.ts",
      "modified",
      "+export const isTerminal = (s: string) => true;",
    );
    const noisy: CodeContext = {
      readFile: () => Promise.resolve(null),
      search: (needle) =>
        Promise.resolve(
          [
            ".cursorrules",
            "docs/DESIGN.md",
            "combined.oas.json",
            ".review/skills/route.md",
            "src/api/route.ts",
          ].map((path, index) => ({ path, line: index + 1, text: needle })),
        ),
    };
    const gathered = await gatherContext({
      languages: LANGUAGES,
      file,
      changeSet: [file],
      context: noisy,
    });
    expect(gathered.usages).toEqual([{ symbol: "isTerminal", paths: ["src/api/route.ts"] }]);
  });

  it("gathers nothing when switched off, and survives a failing port", async () => {
    const off = await gatherContext({
      languages: LANGUAGES,
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
    const degraded = await gatherContext({
      languages: LANGUAGES,
      file,
      changeSet: [file],
      context: broken,
    });
    expect(degraded).toEqual(EMPTY_CONTEXT);
  });

  it("respects the per-kind limits", async () => {
    const context = await gatherContext({
      languages: LANGUAGES,
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
      languages: LANGUAGES,
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
      languages: LANGUAGES,
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

/**
 * A minimal Python, written the way a real one would be: one class of the `Language` kind, nothing in the
 * core touched. If this is all it takes for Definitions, Usages and import-bound Related to work in a new
 * language, the extension point is where it should be.
 */
class TinyPython extends Language {
  readonly id = "tiny-python";
  readonly extensions = ["py"];

  imports(sides: PatchSides): readonly string[] {
    const specifiers = [...sides.added, ...sides.kept].flatMap((line) => {
      const match = /^\s*from\s+(\.[\w.]*)\s+import\b/u.exec(line);
      return match?.[1] === undefined ? [] : [match[1]];
    });
    return [...new Set(specifiers)];
  }

  resolve(fromPath: string, specifier: string): ModuleTarget {
    const dots = /^\.+/u.exec(specifier)?.[0].length ?? 0;
    const rest = specifier.slice(dots).replaceAll(".", "/");
    const up = "../".repeat(Math.max(0, dots - 1));
    const path = joinRelative(fromPath, `./${up}${rest}`);
    return { path, candidates: [`${path}.py`, `${path}/__init__.py`], key: path };
  }

  override moduleKey(path: string): string {
    return path.replace(/(?:\/__init__)?\.py$/u, "");
  }

  exportedNames(lines: readonly string[]): ReadonlySet<string> {
    return new Set(
      lines.flatMap((line) => {
        const match = /^(?:def|class)\s+([A-Za-z_]\w*)/u.exec(line);
        return match?.[1] === undefined || match[1].startsWith("_") ? [] : [match[1]];
      }),
    );
  }

  signatures(text: string, maxChars: number): string {
    return text
      .split("\n")
      .filter((line) => /^(?:def|class)\s/u.test(line))
      .join("\n")
      .slice(0, maxChars);
  }

  override stemOf(path: string): string {
    return super.stemOf(path).replace(/^test_|_test$/u, "");
  }
}

describe("a language the core has never heard of", () => {
  const python = new LanguageRegistry([...BUILTIN_LANGUAGES, new TinyPython()]);
  const service = new ChangedFile(
    "app/users/service.py",
    "modified",
    "-def find_user(user_id):\n+def find_user(user_id, tenant):",
  );
  const handler = new ChangedFile(
    "app/users/handler.py",
    "modified",
    " from .service import find_user\n-    return find_user(user_id)\n+    return find_user(user_id, tenant)",
  );
  const repository = fakeContext({
    "app/users/service.py": "def find_user(user_id, tenant):\n    return db.get(tenant, user_id)\n",
    "app/jobs/sync.py":
      "from ..users.service import find_user\n\ndef sync(ids):\n    return [find_user(i) for i in ids]\n",
  });

  it("gets Definitions, Usages and import-bound Related from one implementation", async () => {
    const forHandler = await gatherContext({
      languages: python,
      file: handler,
      changeSet: [handler, service],
      context: repository,
    });
    expect(forHandler.definitions.map((d) => [d.specifier, d.path])).toEqual([
      [".service", "app/users/service.py"],
    ]);
    expect(forHandler.definitions[0]?.signatures).toBe("def find_user(user_id, tenant):");
    expect(forHandler.related).toEqual([
      { path: "app/users/service.py", relation: "imports", patch: service.patch },
    ]);

    const forService = await gatherContext({
      languages: python,
      file: service,
      changeSet: [handler, service],
      context: repository,
    });
    // The caller the change breaks, which the change never touched.
    expect(forService.usages).toEqual([{ symbol: "find_user", paths: ["app/jobs/sync.py"] }]);
    expect(forService.related[0]?.relation).toBe("imported-by");
  });

  it("is read as plain text without its implementation: related by directory only, nothing else", async () => {
    const gathered = await gatherContext({
      languages: LANGUAGES,
      file: handler,
      changeSet: [handler, service],
      context: repository,
    });
    expect(gathered.definitions).toEqual([]);
    expect(gathered.usages).toEqual([]);
    expect(gathered.related).toEqual([
      { path: "app/users/service.py", relation: "sibling", patch: service.patch },
    ]);
  });

  it("never binds a file of one language to a file of another, by name or by import", () => {
    const tsService = modified("src/users/service.ts", "+export function findUser() {}");
    const pyService = modified("app/users/service.py");
    const pyTest = modified("app/users/test_service.py");
    // Same stem, two languages: not counterparts. A test file named the Python way is.
    expect(
      relatedChanges(pyService, [pyService, tsService, pyTest], python).map((f) => f.path),
    ).toEqual(["app/users/test_service.py"]);
    expect(relationTo(tsService, pyService, python)).toBe("sibling");
  });
});

describe("rendering", () => {
  const context: ReviewContext = {
    definitions: [{ specifier: "./s", path: "src/s.ts", signatures: "export const s = 1;" }],
    usages: [{ symbol: "total", paths: ["a.ts", "b.ts"] }],
    related: [{ path: "src/r.ts", relation: "sibling", patch: "+r" }],
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

  it("says which way an import relation points", () => {
    const text = renderContext(
      {
        ...context,
        related: [
          { path: "src/dep.ts", relation: "imports", patch: "+d" },
          { path: "src/caller.ts", relation: "imported-by", patch: "+c" },
        ],
      },
      10_000,
    );
    expect(text).toContain("--- src/dep.ts (this file imports it)");
    expect(text).toContain("--- src/caller.ts (it imports this file)");
  });

  /**
   * A file importing four documented modules can render 6000 characters of
   * signatures on its own. Under a first-come budget it took the whole block
   * and the related diffs never reached the model.
   */
  it("does not let one long section starve the others", () => {
    const text = renderContext(
      {
        definitions: Array.from({ length: 4 }, (_, index) => ({
          specifier: `./m${index}`,
          path: `src/m${index}.ts`,
          signatures: long(1400),
        })),
        usages: [{ symbol: "total", paths: ["a.ts"] }],
        related: [{ path: "src/dep.ts", relation: "imports", patch: long(1000) }],
      },
      6000,
    );
    expect(text.length).toBeLessThanOrEqual(6000);
    expect(text).toContain("--- src/dep.ts (this file imports it)");
    expect(text).toContain("- total: a.ts");
    // Some definitions still fit; what did not is dropped whole, not cut.
    expect(text).toContain("--- src/m0.ts");
    expect(text).not.toContain("--- src/m3.ts");
  });

  it("drops whole sections past the cap, cutting only when the first would not fit", () => {
    const first = renderContext(context, 130);
    expect(first).toContain("Definitions of modules");
    expect(first).not.toContain("Related files changed");
    expect(renderContext(context, 20)).toHaveLength(20);
    expect(renderContext(EMPTY_CONTEXT, 10_000)).toBe("");
  });

  it("lands in the user prompt after the file content, before the closing ask", () => {
    // The skills are no longer in this text at all: they travel ahead of it
    // as their own message (`reviewMessages`), so a vendor can keep them.
    const prompt = buildUserPrompt({
      path: "a.ts",
      annotatedPatch: "+x",
      allowedLines: [1],
      content: "whole file",
      contextText: "CONTEXT BLOCK",
    });
    const at = (needle: string): number => prompt.indexOf(needle);
    expect(at("whole file")).toBeLessThan(at("CONTEXT BLOCK"));
    expect(at("CONTEXT BLOCK")).toBeLessThan(at("Return the findings JSON now."));
    expect(
      buildUserPrompt({ path: "a", annotatedPatch: "+x", allowedLines: [1], content: null }),
    ).not.toContain("CONTEXT");
  });
});
