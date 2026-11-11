import { defineConfig } from "tsdown";

// One neutral ES module. `iterate` and `zod` stay imports: a loaded worker binds them to the
// platform's own modules (core/os context/module-resolution.ts), and `fflate` loads as this
// package's dependency.
export default defineConfig({
  entry: { index: "src/index.ts" },
  format: "esm",
  fixedExtension: true,
  platform: "neutral",
  target: "es2022",
  deps: { neverBundle: ["cloudflare:workers", "@cloudflare/workers-types"] },
  dts: true,
  clean: true,
});
