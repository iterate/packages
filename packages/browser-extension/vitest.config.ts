import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Each file launches Chromium; keep browser load bounded within the parallel workspace job.
    fileParallelism: false,
    testTimeout: 20_000,
    restoreMocks: true,
    unstubGlobals: true,
    unstubEnvs: true,
    chaiConfig: { truncateThreshold: 0 },
  },
});
