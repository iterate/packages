// dist/components/docs-editor/doc-tree.mjs, after tsdown's modules: the docs editor's file tree
// (src/components/docs-editor/doc-tree.ts) with its own @pierre/trees, which `DocTree` imports
// when it first draws (tsdown.config.ts keeps it out of the modules' build). The repo IDE keeps its
// copy inside its own file, so a page that shows the IDE loads no file more; a page shows one tree
// or the other, never both. `pnpm build` runs it.
import { resolve } from "node:path";
import { build } from "tsdown";

const ui = resolve(import.meta.dirname, "..");

await build({
  // no config file: tsdown.config.ts is the modules' build, which cleans dist
  config: false,
  cwd: ui,
  entry: { "components/docs-editor/doc-tree": "src/components/docs-editor/doc-tree.ts" },
  format: "esm",
  fixedExtension: true,
  outDir: "dist",
  clean: false,
  platform: "browser",
  target: "es2022",
  hash: false,
  minify: true,
  dts: false,
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  deps: { alwaysBundle: [/./], onlyBundle: false },
});
