// A context's log over reconnects (`keptContext`): the rows a view holds stay, as the same
// objects, and a new session's newer rows come after them.
import { expect, test } from "vitest";
import { kept, keptContext } from "./itx-session.ts";

test("a reader's older pages stay over a new session, as the same objects, with only the newer events added", () => {
  const keep = keptContext<Log>();
  // the reader loaded the log back to its first event
  const first = log([1, 2, 3, 4, 5], { exhausted: true });
  expect(keep(first, "/agents/a")).toBe(first);
  // a new session reads: nothing of it yet, then the newest page alone
  expect(keep(log([], { caughtUp: false }), "/agents/a").events === first.events).toBe(true);
  const second = log([4, 5, 6], { exhausted: false });
  const shown = keep(second, "/agents/a");
  expect(shown.events.map((event) => event.offset)).toEqual([1, 2, 3, 4, 5, 6]);
  // the five held events are the objects the view folded and drew, so it adds one row
  expect(shown.events.slice(0, 5).every((event, at) => event === first.events[at])).toBe(true);
  expect(shown.events.at(-1) === second.events.at(-1)).toBe(true);
  // the log is still held from its first event: nothing older is asked for
  expect(shown.older).toMatchObject({ exhausted: true, loading: false });
  // the same input again is the same log: a view folds by identity
  expect(keep({ ...second }, "/agents/a").events === shown.events).toBe(true);
});

test("the held rows stay through the next sessions too, and a push goes after them", () => {
  const keep = keptContext<Log>();
  keep(log([3, 4, 5], { exhausted: false }), "/a");
  keep(log([], { caughtUp: false }), "/a");
  keep(log([4, 5, 6], { exhausted: false }), "/a");
  // the new session reads further back than the held rows go, and a new event arrives
  const more = keep(log([1, 2, 3, 4, 5, 6, 7], { exhausted: true }), "/a");
  expect(more.events.map((event) => event.offset)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  expect(more.older).toMatchObject({ exhausted: true });
  keep(log([], { caughtUp: false }), "/a");
  const third = keep(log([7, 8], { exhausted: false }), "/a");
  expect(third.events.map((event) => event.offset)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  expect(third.events[0] === more.events[0]).toBe(true);
});

test("a new page that starts above the last held event may miss events between: the log is the new session's alone", () => {
  const keep = keptContext<Log>();
  keep(log([1, 2, 3], { exhausted: true }), "/a");
  keep(log([], { caughtUp: false }), "/a");
  const far = log([2_000, 2_001], { exhausted: false });
  expect(keep(far, "/a")).toBe(far);
});

test("a read that failed shows its error over the held rows; another context keeps nothing", () => {
  const keep = keptContext<Log>();
  const first = log([1, 2], { exhausted: true });
  keep(first, "/a");
  keep(log([], { caughtUp: false }), "/a");
  const failed = keep({ ...log([], { caughtUp: false }), error: "refused" }, "/a");
  expect(failed).toMatchObject({ error: "refused" });
  expect(failed.events === first.events).toBe(true);
  const other = log([], { caughtUp: false });
  expect(keep(other, "/b")).toBe(other);
});

test("the processors table and the live state stay until the new ones are read", () => {
  const keep = keptContext<Log>();
  const first = log([1], { exhausted: true });
  keep(first, "/a");
  const reading = {
    ...log([1, 2], { exhausted: true }),
    processors: { loaded: false },
    liveState: { core: { status: "connecting" } },
  };
  const shown = keep(reading, "/a");
  expect(shown.events.map((event) => event.offset)).toEqual([1, 2]);
  expect(shown.processors === first.processors).toBe(true);
  expect(shown.liveState === first.liveState).toBe(true);
});

test("a kept value is its last settled answer under the same key", () => {
  const keep = kept<string | undefined>();
  expect(keep(undefined, false, "a")).toBe(undefined);
  expect(keep("rows", true, "a")).toBe("rows");
  expect(keep(undefined, false, "a")).toBe("rows");
  expect(keep(undefined, false, "b")).toBe(undefined);
});

type Log = ReturnType<typeof log>;

/** What `useIterateContext` returns, with events at `offsets`. */
function log(offsets: number[], { caughtUp = true, exhausted = false }) {
  return {
    events: offsets.map((offset) => ({ offset })),
    caughtUp,
    error: undefined as string | undefined,
    older: { loadOlder() {}, loading: !caughtUp, exhausted },
    processors: { loaded: true },
    liveState: { agent: { status: "live" } } as Record<string, { status: string }>,
  };
}
