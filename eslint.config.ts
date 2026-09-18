import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import prettier from "eslint-config-prettier";
import importX from "eslint-plugin-import-x";
import n from "eslint-plugin-n";
import unicorn from "eslint-plugin-unicorn";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  {
    ignores: ["coverage/**", "node_modules/**", "tests/fixtures/**"],
  },

  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  importX.flatConfigs.recommended,
  importX.flatConfigs.typescript,
  n.configs["flat/recommended-module"],
  unicorn.configs.recommended,

  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: globals.node,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    settings: {
      "import-x/resolver": { typescript: true, node: true },
      // Bun's own modules are not files a resolver can find.
      "import-x/core-modules": ["bun", "bun:test"],
      n: { allowModules: ["bun"] },
    },
    rules: {
      // -- hexagonal layering: the core never imports an adapter or the CLI --
      "import-x/no-cycle": "error",
      "import-x/no-restricted-paths": [
        "error",
        {
          zones: [
            {
              target: "./src/core",
              from: ["./src/providers", "./src/cli"],
              message: "core/ must not depend on providers/ or cli/ (dependency inversion).",
            },
            {
              target: "./src/providers",
              from: ["./src/cli"],
              message: "providers/ must not depend on cli/.",
            },
            // `lib/` is the bottom of the stack: general-purpose code that
            // could be published on its own. Everything may use it; it may
            // use nothing of ours. A `lib/` that reached back into the
            // application would be an application module in a folder that
            // promises it is not one.
            {
              target: "./src/lib",
              from: ["./src/core", "./src/providers", "./src/cli"],
              message:
                "lib/ is standalone: it must not depend on core/, providers/ or cli/ (it is the layer they all may use).",
            },
          ],
        },
      ],
      "import-x/order": [
        "error",
        {
          groups: ["builtin", "external", "internal", "parent", "sibling", "index", "type"],
          "newlines-between": "always",
          alphabetize: { order: "asc", caseInsensitive: true },
        },
      ],
      "import-x/no-default-export": "error",
      // Relative imports name the source file, without an extension: Bun runs the
      // TypeScript as it is, so there is no emitted-extension (".js") to spell.
      // `import-x/extensions` catches an explicit ".ts"; it does not see a ".js" that
      // resolves to a .ts file, so that spelling is refused by name.
      "import-x/extensions": ["error", "never", { ignorePackages: true, checkTypeImports: true }],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: String.raw`^\.{1,2}/.*\.js$`,
              message:
                'Import the source module without an extension ("./x", not "./x.js"); there is no emitted file to name.',
            },
          ],
        },
      ],

      // -- type discipline --
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
      "@typescript-eslint/consistent-type-definitions": ["error", "interface"],
      "@typescript-eslint/explicit-module-boundary-types": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "all" },
      ],
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true, allowBoolean: false, allowNullish: false, allowAny: false },
      ],
      "@typescript-eslint/no-unnecessary-condition": "error",
      "@typescript-eslint/prefer-readonly": "error",
      "@typescript-eslint/member-ordering": "error",

      // -- runtime: Bun, through Node's API surface --
      "n/no-missing-import": "off", // handled by import-x with the TS resolver
      // These three read `engines.node` to gate the API; the runtime is Bun, and
      // what it implements is not a Node version.
      "n/no-unsupported-features/node-builtins": "off",
      "n/no-unsupported-features/es-builtins": "off",
      "n/no-unsupported-features/es-syntax": "off",
      // The executables' shebang carries a flag (`-S bun --no-env-file`); the rule
      // knows only bare interpreters.
      "n/hashbang": "off",
      "n/no-process-exit": "off", // the CLI entry point owns the exit code

      // -- unicorn: keep the signal, drop the style noise that fights the port --
      "unicorn/prevent-abbreviations": "off",
      // "Repository" is a domain term (CONTEXT.md); a `RepoProvider` would be
      // the one place the code spells it differently from the glossary.
      "unicorn/name-replacements": ["error", { replacements: { repository: false } }],
      "unicorn/no-null": "off", // JSON payloads from providers carry null
      "unicorn/no-array-reduce": "off",
      "unicorn/filename-case": ["error", { case: "kebabCase" }],
      "unicorn/no-array-for-each": "off",
      "unicorn/prefer-top-level-await": "off",
      "unicorn/no-process-exit": "off",
      "unicorn/prefer-string-raw": "off",
      "unicorn/no-array-callback-reference": "off",
      "unicorn/prefer-module": "error",
      "unicorn/prefer-node-protocol": "error",
      "unicorn/import-style": "off",
      "unicorn/prefer-iterator-zip": "off", // Iterator.zip is not in Bun
      "unicorn/consistent-class-member-order": "off", // public API first; @typescript-eslint/member-ordering governs
      "@typescript-eslint/non-nullable-type-assertion-style": "off", // conflicts with no-non-null-assertion
      "unicorn/single-line-block-comment-style": "off",
    },
  },

  // Tests: boundary-type noise off, and no test left focused or switched off.
  // Two homes, one rule set: `tests/` mirrors `src/`, and `src/lib/*/tests/`
  // travels with the library it covers.
  {
    files: ["tests/**/*.ts", "src/lib/**/tests/**/*.ts"],
    rules: {
      // `bun test` runs a `.only` silently -- the rest of the file vanishes from
      // the run with no report -- and a `.skip` is a test that no longer counts.
      // Neither belongs in a commit; there is no test-runner plugin for Bun, so
      // the shape is refused by syntax.
      "no-restricted-syntax": [
        "error",
        {
          // `it.only(`, `describe.skip(`, `test.todo(`, and `it.skip.each(` through
          // its inner member expression.
          selector:
            "MemberExpression[object.name=/^(it|test|describe)$/][property.name=/^(only|skip|todo)$/]",
          message:
            "A focused, skipped or todo test does not go in: every test in the file must run.",
        },
      ],
      // `await expect(p).rejects.toThrow()` is how an async rejection is asserted,
      // and the await is load-bearing; bun-types declares `rejects` as plain
      // `Matchers` whose methods return void, so the type checker sees an
      // awaited void. The types are wrong, not the tests.
      "@typescript-eslint/await-thenable": "off",
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/explicit-module-boundary-types": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },

  // The ESLint config exports a default by convention of its tool, and ESLint
  // plugins are published as default exports that also carry named members.
  {
    files: ["eslint.config.ts"],
    rules: {
      "import-x/no-default-export": "off",
      "import-x/no-named-as-default": "off",
      "import-x/no-named-as-default-member": "off",
    },
  },

  prettier,
);
