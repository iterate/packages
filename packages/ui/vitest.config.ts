import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { vitestReporters } from "../shared/src/test-support/e2e-policy/vitest-reporters.ts";

export default defineConfig({
  resolve: {
    alias: {
      // src/apps/server.ts reads the Worker's bindings from `env`, which its test fills in.
      "cloudflare:workers": fileURLToPath(
        new URL("../../core/lib/src/test-support/cloudflare-workers-shim.ts", import.meta.url),
      ),
    },
  },
  test: {
    // @atomic-editor/editor's dist imports its own modules with no extension, which Node's ESM
    // loader refuses: vitest bundles it as a bundler would (the docs editor's session test)
    server: { deps: { inline: ["@atomic-editor/editor"] } },
    reporters: vitestReporters,
    restoreMocks: true,
    unstubGlobals: true,
    unstubEnvs: true,
    chaiConfig: { truncateThreshold: 0 },
    silent: "passed-only",
  },
});
