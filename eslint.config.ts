import js from "@eslint/js";
import vitest from "@vitest/eslint-plugin";
import { defineConfig } from "eslint/config";
import prettier from "eslint-config-prettier";
import importX from "eslint-plugin-import-x";
import n from "eslint-plugin-n";
import unicorn from "eslint-plugin-unicorn";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  {
    ignores: ["dist/**", "coverage/**", "node_modules/**", "tests/fixtures/**"],
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
              from: ["./src/infra", "./src/cli"],
              message: "core/ must not depend on infra/ or cli/ (dependency inversion).",
            },
            {
              target: "./src/infra",
              from: ["./src/cli"],
              message: "infra/ must not depend on cli/.",
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
      // Relative imports name the source file, without an extension: the project is
      // bundled (tsup) and run by bundler-style resolvers (vitest, tsx), so there is no
      // emitted-extension (".js") to spell. `import-x/extensions` catches an explicit
      // ".ts"; it does not see a ".js" that resolves to a .ts file, so that spelling is
      // refused by name.
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

      // -- node --
      "n/no-missing-import": "off", // handled by import-x with the TS resolver
      "n/no-unsupported-features/node-builtins": ["error", { version: ">=24" }],
      "n/no-process-exit": "off", // the CLI entry point owns the exit code

      // -- unicorn: keep the signal, drop the style noise that fights the port --
      "unicorn/prevent-abbreviations": "off",
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
      "unicorn/prefer-iterator-zip": "off", // Iterator.zip is not in Node 24
      "unicorn/consistent-class-member-order": "off", // public API first; @typescript-eslint/member-ordering governs
      "@typescript-eslint/non-nullable-type-assertion-style": "off", // conflicts with no-non-null-assertion
      "unicorn/single-line-block-comment-style": "off",
    },
  },

  // Tests: vitest rules on, boundary-type noise off.
  {
    files: ["tests/**/*.ts"],
    plugins: { vitest },
    rules: {
      ...vitest.configs.recommended.rules,
      "vitest/expect-expect": ["error", { assertFunctionNames: ["expect", "expectContract"] }],
      "vitest/no-focused-tests": "error",
      "vitest/no-disabled-tests": "warn",
      "@typescript-eslint/explicit-module-boundary-types": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },

  // Config files export a default by convention of their tools, and ESLint
  // plugins are published as default exports that also carry named members.
  {
    files: ["*.config.ts", "eslint.config.ts"],
    rules: {
      "import-x/no-default-export": "off",
      "import-x/no-named-as-default": "off",
      "import-x/no-named-as-default-member": "off",
    },
  },

  prettier,
);
