/**
 * The e2e retry policy and timeout ladder, in one place.
 *
 * The policy (evidence and rationale: docs/testing.md#retries-and-timeouts):
 *
 * 1. Retries live in exactly ONE layer: the individual test — the smallest
 *    unit that owns its state (every test provisions its own mind). One
 *    retry in CI, zero locally.
 * 2. Everything above a test is a watchdog: it fails, it never retries.
 *    Re-running is the outer edge's job (Depot re-run / next push).
 * 3. Watchdogs are sized to ~2x the healthy p99 of what they bound — never
 *    to accommodate worst-case retry stacks. A run burning retries against a
 *    wedged platform SHOULD get killed.
 * 4. Waits are progress-based (spinner-waiter); static budgets are backstops.
 * 5. Retries are measured, never silent (RetryTelemetryReporter, beside this file).
 */

/**
 * Per-test retries in CI, everywhere (vitest `retry`, playwright `retries`).
 * One, not two: across the 50-green-run marathon audit (~5,800 test
 * executions) no test ever needed a second retry, and a platform-incident
 * burst that defeats a single retry should fail the run — weather we want to
 * see, not absorb. Zero locally so a flaky test stays loud at your desk.
 */
export const E2E_CI_RETRIES = 1;

/**
 * Pause before the vitest retry (vitest `retry.delay`). Zero-delay retries
 * re-run INTO the blip that failed the first attempt: observed twice on the
 * streams-example-app capnweb suite, where a fresh websocket died and the
 * instant re-roll died the same way within the same second (post-deploy
 * rollout propagation / a brief edge wobble). 5s is longer than every blip
 * observed and far below any test timeout. Playwright needs no equivalent:
 * its retry tears down and rebuilds the whole browser worker, which takes
 * seconds by construction.
 */
export const E2E_CI_RETRY_DELAY_MS = 5_000;

/**
 * THE ROW BUDGET. The e2e run starts every file at once and every row within a file concurrently,
 * so its wall is its startup plus its slowest row: one slow row makes every PR wait for it
 * (docs/testing.md#the-row-budget). A row that runs on every PR finishes within
 * `E2E_ROW_BUDGET_MS` at its p95. RetryTelemetryReporter prints each e2e row that ran longer than
 * `E2E_ROW_WARN_MS` (`[row-budget]`), and the flake dashboard's Cost section proposes making a row
 * faster, or tagging it `slow`, once its p95 passes the budget.
 */
export const E2E_ROW_WARN_MS = 45_000;
export const E2E_ROW_BUDGET_MS = 60_000;
