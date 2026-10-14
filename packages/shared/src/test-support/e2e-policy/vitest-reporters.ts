import { fileURLToPath } from "node:url";

/** Every workspace's vitest reporters: the console's, and the retry telemetry CI uploads
 *  (docs/ci-test-telemetry.md). Each vitest.config.ts sets `test.reporters` to this, so every
 *  `test` script is plain `vitest run`. VITEST_HTML_REPORT adds vitest's HTML report, written
 *  there: a cowboy run's e2e rows (scripts/ci/cowboy.ts `runE2e`), whose trace links each test to
 *  it. Only test/ has @vitest/ui, which writes it. */
export const vitestReporters = [
  "default",
  fileURLToPath(new URL("./retry-telemetry-reporter.ts", import.meta.url).href),
  ...(process.env.VITEST_HTML_REPORT
    ? [["html", { outputFile: process.env.VITEST_HTML_REPORT }] as ["html", { outputFile: string }]]
    : []),
];
