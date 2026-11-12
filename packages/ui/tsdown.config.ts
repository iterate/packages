import { defineConfig } from "tsdown";
import { browserEntries, vendorChunks } from "./browser-entries.ts";

// THE BUILD A NO-BUILD PAGE IMPORTS (browser-entries.ts names the entries). Every dependency is
// bundled, so React, Base UI and CodeMirror each load once, whichever components a page imports, and
// no import is left for the host to resolve: the files run from esm.sh, jsDelivr or any static host.
// Vendor code sits in chunks named by library (browser-entries.ts `vendorChunks`), which change only
// when its version does, so a change to a component rewrites that component's files and nothing else.
export default defineConfig({
  entry: browserEntries(),
  format: "esm",
  fixedExtension: true,
  platform: "browser",
  target: "es2022",
  hash: false,
  minify: true,
  dts: false,
  clean: true,
  // the source is written for Vite, which sets these; this build only ever runs in a browser
  define: {
    "import.meta.env.SSR": "false",
    "import.meta.env.DEV": "false",
    "import.meta.env.BASE_URL": JSON.stringify("/"),
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  loader: { ".svg": "dataurl" },
  deps: { alwaysBundle: [/./], onlyBundle: false },
  inputOptions: {
    // React libraries mark their modules "use client", which means nothing outside a server build
    onLog: (level, log, handler) => log.code === "MODULE_LEVEL_DIRECTIVE" || handler(level, log),
  },
  outputOptions: {
    chunkFileNames: "chunks/[name].mjs",
    codeSplitting: {
      groups: vendorChunks,
    },
  },
});
