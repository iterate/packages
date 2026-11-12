// @vitest-environment jsdom
// The analytics page: HOW OFTEN it asks the mind's telemetry. Each read is a query of the stack's
// telemetry Worker, so the page must not ask at each render, and its one timer must not pile up.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { AnalyticsPage, TelemetryOff, type TelemetryQuery } from "./analytics-page.tsx";

test("the live charts are read again thirty seconds after each answer: one read at a time, none while the tab is hidden, none after the page has gone", async () => {
  using page = ownClock();
  const telemetry = fakeTelemetry();
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(() => root.render(<AnalyticsPage query={telemetry.query} />));
  await act(() => vi.advanceTimersByTimeAsync(1_000));
  expect(telemetry.live()).toBe(1);
  await act(() => vi.advanceTimersByTimeAsync(30_000));
  expect(telemetry.live()).toBe(2);

  // a slow answer: the next read waits for it, however long, and thirty seconds more
  telemetry.liveTakes(100_000);
  await act(() => vi.advanceTimersByTimeAsync(30_000));
  expect(telemetry.live()).toBe(3);
  await act(() => vi.advanceTimersByTimeAsync(95_000));
  expect(telemetry.live()).toBe(3);
  telemetry.liveTakes(0);
  await act(() => vi.advanceTimersByTimeAsync(5_000 + 30_000));
  expect(telemetry.live()).toBe(4);

  // a hidden tab reads nothing, and reads again once it is shown
  page.tabIs("hidden");
  await act(() => vi.advanceTimersByTimeAsync(5 * 60_000));
  expect(telemetry.live()).toBe(4);
  page.tabIs("shown");
  await act(() => vi.advanceTimersByTimeAsync(30_000));
  expect(telemetry.live()).toBe(5);

  await act(() => root.unmount());
  await vi.advanceTimersByTimeAsync(5 * 60_000);
  expect(telemetry.live()).toBe(5);
});

test("everything else is asked once when the page mounts: a page that renders ten times, over ten minutes, asks nothing again", async () => {
  using _clock = ownClock();
  const telemetry = fakeTelemetry();
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  for (let render = 0; render < 10; render += 1)
    await act(() => root.render(<AnalyticsPage query={telemetry.query} />));
  await act(() => vi.advanceTimersByTimeAsync(1_000));
  const once = telemetry.others();
  // the day's charts, the storage table, and the Activity section's two
  expect(once).toBeGreaterThan(3);
  await act(() => vi.advanceTimersByTimeAsync(10 * 60_000));
  expect(telemetry.others()).toBe(once);
  await act(() => root.unmount());
});

test("a page that is handed another query function asks that one for the day's charts too, once", async () => {
  using _clock = ownClock();
  const first = fakeTelemetry();
  const second = fakeTelemetry();
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(() => root.render(<AnalyticsPage query={first.query} />));
  await act(() => vi.advanceTimersByTimeAsync(1_000));
  const once = first.others();
  // the page stays up and its mind changes: another function
  for (let render = 0; render < 5; render += 1)
    await act(() => root.render(<AnalyticsPage query={second.query} />));
  await act(() => vi.advanceTimersByTimeAsync(1_000));
  expect(second.others()).toBe(once);
  expect(second.live()).toBe(1);
  expect(first.others()).toBe(once);
  await act(() => root.unmount());
});

/** The test's own clock and a tab that is shown, until the test ends. The charts measure their own
 *  width, which jsdom does not do, so the observer they ask for does nothing. */
test("a mind with telemetry off gets something to do: where to turn it on, with a link to its own card, and what a mind deployed by hand needs", async () => {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  await act(() => root.render(<TelemetryOff mind="example.com" />));
  expect(host.textContent).toContain("Telemetry is off for this mind");
  expect(host.textContent).toContain("press “Turn on telemetry”, then “Update iterate”");
  expect(
    [...host.querySelectorAll("a")].map((link) => `${link.textContent}: ${link.href}`),
  ).toEqual([
    "Open cloud.iterate.com: https://cloud.iterate.com/deployments#example.com",
    "The README has the commands: https://github.com/iterate/core/blob/main/core/alchemy/README.md#telemetry",
  ]);
  // "stack" is a word of the code: a person is told what to do, in their words
  expect(host.textContent).not.toMatch(/stack/i);
  await act(() => root.unmount());
});

function ownClock() {
  vi.useFakeTimers();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  const tabIs = (state: "shown" | "hidden") =>
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => state === "hidden",
    });
  tabIs("shown");
  return {
    tabIs,
    [Symbol.dispose]() {
      vi.useRealTimers();
      tabIs("shown");
    },
  };
}

/** A mind's telemetry that answers every query with no rows, and counts: the live charts' query is
 *  the one over the last hour. */
function fakeTelemetry() {
  let live = 0;
  let others = 0;
  let liveMs = 0;
  const query: TelemetryQuery = async (sql, hours) => {
    if (hours === 1) {
      live += 1;
      if (liveMs) await new Promise((resolve) => setTimeout(resolve, liveMs));
    } else others += 1;
    return { rows: [], sql };
  };
  return {
    query,
    live: () => live,
    others: () => others,
    /** How long the live query's next answers take. */
    liveTakes(ms: number) {
      liveMs = ms;
    },
  };
}
