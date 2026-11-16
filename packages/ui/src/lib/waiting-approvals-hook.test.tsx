// @vitest-environment jsdom
// The count of what waits for approval, as a page's shell holds it: HOW OFTEN it reads the mind.
// A read shares the page's socket with the page's own reads, so the count must not read on each
// render, and its first read waits until the page has drawn.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { askWaitingApprovals, useWaitingApprovals } from "./waiting-approvals.ts";

test("a shell that renders ten times reads the mind once, with a new `read` at each render too", async () => {
  using _clock = fakeClock();
  const mind = fakeMind();
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  for (let render = 0; render < 10; render += 1)
    // a page's client hands the shell a new `read` at each navigation: a new function each time
    await act(() =>
      root.render(<Shell mind="ten.example.com" read={mind.reader()} tick={render} />),
    );
  await pass(4_000);
  expect(mind.reads()).toBe(1);
  expect(document.body.textContent).toContain("waiting: 1");
  await act(() => root.unmount());
});

test("the count is not known before the first answer, and is 0 only when the mind says so", async () => {
  using _clock = fakeClock();
  const mind = fakeMind();
  const held = mind.hold();
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(() => root.render(<Shell mind="first.example.com" read={mind.reader()} tick={0} />));
  await pass(4_000);
  expect(mind.reads()).toBe(1);
  expect(document.body.textContent).toContain("waiting: not known");
  held.release();
  await pass(1_000);
  expect(document.body.textContent).toContain("waiting: 1");
  await act(() => root.unmount());
});

test("the first read waits three seconds, so the page's own content is read first, and a second shell adds no wait", async () => {
  using _clock = fakeClock();
  const mind = fakeMind();
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(() => root.render(<Shell mind="later.example.com" read={mind.reader()} tick={0} />));
  const timers = vi.getTimerCount();
  await pass(1_000);
  // a second shell of the same mind, a second later: it shares the wait that runs
  const second = createRoot(document.body.appendChild(document.createElement("div")));
  await act(() => second.render(<Shell mind="later.example.com" read={mind.reader()} tick={0} />));
  expect(vi.getTimerCount()).toBe(timers);
  await pass(1_000);
  expect(mind.calls()).toBe(0);
  expect(document.body.textContent).toContain("waiting: not knownwaiting: not known");
  await pass(1_000);
  await pass(1_000);
  expect(mind.reads()).toBe(1);
  expect(document.body.textContent).toContain("waiting: 1waiting: 1");
  await pass(10_000);
  expect(mind.reads()).toBe(1);
  await act(() => root.unmount());
  await act(() => second.unmount());
});

test("a page that says the list changed before the three seconds are over is answered at once", async () => {
  using _clock = fakeClock();
  const mind = fakeMind();
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(() => root.render(<Shell mind="soon.example.com" read={mind.reader()} tick={0} />));
  await pass(500);
  askWaitingApprovals("soon.example.com");
  await pass(100);
  expect(mind.reads()).toBe(1);
  expect(document.body.textContent).toContain("waiting: 1");
  // the wait ends with an answer this new: it reads nothing more
  await pass(3_000);
  expect(mind.reads()).toBe(1);
  await act(() => root.unmount());
});

test("two shells of one mind share one read, one timer and one count", async () => {
  using _clock = fakeClock();
  const mind = fakeMind();
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(() =>
    root.render(
      <>
        <Shell mind="two.example.com" read={mind.reader()} tick={0} />
        <Shell mind="two.example.com" read={mind.reader()} tick={0} />
      </>,
    ),
  );
  await pass(4_000);
  expect(mind.reads()).toBe(1);
  expect(document.body.textContent).toContain("waiting: 1waiting: 1");
  // five minutes on, with the tab in front: one read more, not one for each shell
  await pass(5 * 60_000);
  expect(mind.reads()).toBe(2);
  await act(() => root.unmount());
  // nobody shows the mind: the timer is gone
  await vi.advanceTimersByTimeAsync(30 * 60_000);
  expect(mind.reads()).toBe(2);
});

test("a page that decided something asks once more, however often it says so while a read runs", async () => {
  using _clock = fakeClock();
  const mind = fakeMind();
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(() => root.render(<Shell mind="ask.example.com" read={mind.reader()} tick={0} />));
  await pass(4_000);
  expect(mind.reads()).toBe(1);
  const held = mind.hold();
  for (let said = 0; said < 5; said += 1) askWaitingApprovals("ask.example.com");
  held.release();
  await pass(1_000);
  // the read that ran, and one more for everything said meanwhile
  expect(mind.reads()).toBe(3);
  await act(() => root.unmount());
});

/** The clock is the test's until the test ends. */
function fakeClock() {
  vi.useFakeTimers();
  return { [Symbol.dispose]: () => void vi.useRealTimers() };
}

/** Let `ms` of the test's clock pass, and what it started run. */
function pass(ms: number) {
  return act(() => vi.advanceTimersByTimeAsync(ms));
}

function Shell({ mind, read, tick }: { mind: string; read: never; tick: number }) {
  const waiting = useWaitingApprovals(mind, read);
  return <p data-tick={tick}>waiting: {waiting ?? "not known"}</p>;
}

/** A mind with one secret, whose one request waits. `reads` counts the reads of its approvals: each
 *  starts by asking whether the mind has a vault. `calls` counts every call the mind got. `hold`
 *  makes the next reads wait for `release`. */
function fakeMind() {
  let reads = 0;
  let calls = 0;
  let gate: Promise<void> | undefined;
  const logs: Record<
    string,
    { type: string; payload: unknown; createdAt: string; offset: number }[]
  > = {
    "/secrets": [
      {
        type: "events.iterate.com/itx/child-created",
        payload: { childPath: "/secrets/gmail" },
        createdAt: new Date().toISOString(),
        offset: 1,
      },
    ],
    "/secrets/gmail": [
      {
        type: "events.iterate.com/secret/approval-requested",
        payload: { digest: "d1", method: "POST", url: "https://example.net/send", bodyStart: "{" },
        createdAt: new Date().toISOString(),
        offset: 1,
      },
    ],
  };
  const itx = {
    rewriteRules: {
      get: async () => {
        reads += 1;
        await gate;
        return { target: "itx.builtins.secrets" };
      },
    },
    contexts: {
      list: async () => [
        {
          path: "/secrets/gmail",
          eventCount: 1,
          eventTypes: { "events.iterate.com/secret/approval-requested": 1 },
        },
      ],
    },
    cd: (path: string) => ({
      readEvents: async () => ({
        events: logs[path] || [],
        scannedThroughOffset: (logs[path] || []).length,
        atHead: true,
      }),
      [Symbol.dispose]() {},
    }),
  };
  return {
    reads: () => reads,
    calls: () => calls,
    /** A new function at each call, as a page's client makes one at each navigation. */
    reader: () =>
      (async (ask: (root: typeof itx) => unknown) => {
        calls += 1;
        return await ask(itx);
      }) as never,
    hold() {
      let release = () => {};
      gate = new Promise<void>((resolve) => (release = resolve));
      return {
        release() {
          gate = undefined;
          release();
        },
      };
    },
  };
}
