// dist/agent-kind-view-frame.js, after tsdown's modules: the script of the frame a kind's chat view
// runs in (browser-entries.ts `AGENT_KIND_VIEW_FRAME` says why it is one classic script). Every
// dependency is inside it, React among them: the frame shares nothing with the page that made it.
// `pnpm build` runs it.
import { resolve } from "node:path";
import { build } from "tsdown";
import { AGENT_KIND_VIEW_FRAME } from "../browser-entries.ts";

const ui = resolve(import.meta.dirname, "..");

await build({
  // no config file: tsdown.config.ts is the modules' build, which cleans dist
  config: false,
  cwd: ui,
  entry: { [AGENT_KIND_VIEW_FRAME.replace(/\.js$/, "")]: "src/browser/agent-kind-view-frame.ts" },
  format: "iife",
  outDir: "dist",
  clean: false,
  platform: "browser",
  target: "es2022",
  hash: false,
  minify: true,
  dts: false,
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
  outputOptions: { entryFileNames: AGENT_KIND_VIEW_FRAME },
});
