// @vitest-environment jsdom
// The count of what waits for approval, as a page's shell holds it: HOW OFTEN it reads the mind.
// One read is one read of every secret's log, so the count must not read on each render.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { askWaitingApprovals, useWaitingApprovals } from "./waiting-approvals.ts";

test("a shell that renders ten times reads the mind once, with a new `read` at each render too", async () => {
  const mind = fakeMind();
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  for (let render = 0; render < 10; render += 1)
    // a page's client hands the shell a new `read` at each navigation: a new function each time
    await act(() =>
      root.render(<Shell mind="ten.example.com" read={mind.reader()} tick={render} />),
    );
  await mind.settled();
  expect(mind.reads()).toBe(1);
  expect(document.body.textContent).toContain("waiting: 1");
  await act(() => root.unmount());
});

test("two shells of one mind share one read, one timer and one count", async () => {
  vi.useFakeTimers();
  try {
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
    // the clock is the test's: a second of it lets the first read end
    await act(() => vi.advanceTimersByTimeAsync(1_000));
    expect(mind.reads()).toBe(1);
    expect(document.body.textContent).toContain("waiting: 1waiting: 1");
    // five minutes on, with the tab in front: one read more, not one for each shell
    await act(() => vi.advanceTimersByTimeAsync(5 * 60_000));
    expect(mind.reads()).toBe(2);
    await act(() => root.unmount());
    // nobody shows the mind: the timer is gone
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(mind.reads()).toBe(2);
  } finally {
    vi.useRealTimers();
  }
});

test("a page that decided something asks once more, however often it says so while a read runs", async () => {
  const mind = fakeMind();
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(() => root.render(<Shell mind="ask.example.com" read={mind.reader()} tick={0} />));
  await mind.settled();
  expect(mind.reads()).toBe(1);
  const held = mind.hold();
  for (let said = 0; said < 5; said += 1) askWaitingApprovals("ask.example.com");
  held.release();
  await mind.settled();
  // the read that ran, and one more for everything said meanwhile
  expect(mind.reads()).toBe(3);
  await act(() => root.unmount());
});

function Shell({ mind, read, tick }: { mind: string; read: never; tick: number }) {
  const waiting = useWaitingApprovals(mind, read);
  return <p data-tick={tick}>waiting: {waiting}</p>;
}

/** A mind with one secret, whose one request waits. `reads` counts the reads of its approvals: each
 *  starts by asking whether the mind has a vault. `hold` makes the next reads wait for `release`. */
function fakeMind() {
  let reads = 0;
  let running = 0;
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
    /** A new function at each call, as a page's client makes one at each navigation. */
    reader: () =>
      (async (ask: (root: typeof itx) => unknown) => {
        running += 1;
        try {
          return await ask(itx);
        } finally {
          running -= 1;
        }
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
    /** Every read that was started is over, and so is what it started. */
    async settled() {
      for (let quiet = 0; quiet < 5;) {
        await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
        quiet = running === 0 ? quiet + 1 : 0;
      }
    },
  };
}
