import { type Options, defineConfig } from "tsup";

const shared: Options = {
  format: ["esm"],
  target: "node24",
  platform: "node",
  sourcemap: true,
  splitting: false,
  dts: false,
};

export default defineConfig([
  // The two executables, each self-contained with a shebang. They are built
  // together and shipped together, but they are separate processes on
  // purpose: `reviewer` calls a model and cannot post, `review-comment`
  // holds a token and cannot call a model (ADR 0009).
  {
    ...shared,
    entry: { "cli/index": "src/cli/index.ts", "cli/comment": "src/cli/comment-main.ts" },
    clean: true,
    banner: { js: "#!/usr/bin/env node" },
  },
  // The embeddable core, for a UI or server that brings its own adapters.
  {
    ...shared,
    entry: { "core/index": "src/core/index.ts" },
    clean: false,
  },
]);
