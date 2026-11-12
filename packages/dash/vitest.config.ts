import { defineConfig } from "vitest/config";
import { vitestReporters } from "../../packages/shared/src/test-support/e2e-policy/vitest-reporters.ts";

export default defineConfig({
  test: {
    reporters: vitestReporters,
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // The Dash's own logic and its tests are in packages/ui (lib/waiting-approvals.ts and the
    // files beside it). A test of a route's own code goes here.
    passWithNoTests: true,
    restoreMocks: true,
    unstubGlobals: true,
    unstubEnvs: true,
    chaiConfig: { truncateThreshold: 0 },
    silent: "passed-only",
  },
});
