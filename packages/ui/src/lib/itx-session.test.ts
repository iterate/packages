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

test("a saved tail is shown before the read has caught up: its events, caught up, a saved copy, the same object again", () => {
  const keep = keptContext<Stamped>();
  const seed = tail([5, 6, 7], { exhausted: false });
  const reading = stamped([], { caughtUp: false });
  const shown = keep(reading, "/a", seed);
  expect(shown).toMatchObject({
    caughtUp: true,
    savedCopy: true,
    head: 7,
    older: { loading: false, exhausted: false },
  });
  expect(shown.events === seed.events).toBe(true);
  // React can replay a render: the same input is the same answer
  expect(keep(reading, "/a", seed)).toBe(shown);
});

test("after the catch-up the saved events stay as the same objects, the newer ones follow, and it is no saved copy", () => {
  const keep = keptContext<Stamped>();
  const seed = tail([5, 6, 7], { exhausted: true });
  keep(stamped([], { caughtUp: false }), "/a", seed);
  // the read starts at the copy's newest event (`since`), which it returns again
  const live = stamped([7, 8, 9], { exhausted: false });
  const shown = keep(live, "/a", seed);
  expect(shown.events.map((event) => event.offset)).toEqual([5, 6, 7, 8, 9]);
  expect(shown.events.slice(0, 3)).toEqual(seed.events);
  expect(shown.events.slice(0, 3).every((event, at) => event === seed.events[at])).toBe(true);
  expect(shown.events.at(-1)).toBe(live.events.at(-1));
  expect(shown).toMatchObject({ older: { exhausted: true } });
  expect(shown).not.toHaveProperty("savedCopy", true);
});

test.for([
  {
    name: "a gap: the read starts above the copy's newest event",
    live: [9, 10],
    at7: "t7",
    another: false,
  },
  {
    name: "another event at the copy's newest offset (the log made again)",
    live: [7, 8],
    at7: "x",
    // the read began at that offset: what lies below it in the new log is not held yet
    another: true,
  },
  { name: "a log shorter than the copy", live: [1, 2, 3], at7: "t7", another: false },
])(
  "the saved rows go when the read does not hold the copy's newest event: $name",
  ({ live, at7, another }) => {
    const keep = keptContext<Stamped>();
    const seed = tail([5, 6, 7], { exhausted: false });
    keep(stamped([], { caughtUp: false }), "/a", seed);
    expect(keep.anotherLog("/a")).toBe(false);
    const read = stamped(live, { exhausted: false });
    for (const event of read.events) if (event.offset === 7) event.createdAt = at7;
    expect(keep(read, "/a", seed)).toBe(read);
    expect(keep.anotherLog("/a")).toBe(another);
    // another key knows nothing of it
    expect(keep.anotherLog("/b")).toBe(false);
  },
);

test("an error while a saved copy is shown drops its rows; so does a call without the copy", () => {
  const seed = tail([5, 6, 7], { exhausted: false });
  const refused = keptContext<Stamped>();
  refused(stamped([], { caughtUp: false }), "/a", seed);
  const failed = { ...stamped([], { caughtUp: false }), error: "refused" };
  expect(refused(failed, "/a", seed)).toBe(failed);
  const withdrawn = keptContext<Stamped>();
  withdrawn(stamped([], { caughtUp: false }), "/a", seed);
  const reading = stamped([], { caughtUp: false });
  expect(withdrawn(reading, "/a")).toBe(reading);
});

test("through is the newest durable offset last shown for the key, also when the newest event is ephemeral", () => {
  const keep = keptContext<Stamped>();
  expect(keep.through("/a")).toBe(undefined);
  keep(stamped([], { caughtUp: false }), "/a", tail([5, 6, 7], { exhausted: false }));
  expect(keep.through("/a")).toBe(7);
  const live = stamped([7, 8, 9], { exhausted: false });
  live.events[2]!.ephemeral = true;
  keep(live, "/a", tail([5, 6, 7], { exhausted: false }));
  expect([keep.through("/a"), keep.through("/b")]).toEqual([8, undefined]);
});

test("a saved tail changes nothing once a read has caught up: the log is the live one", () => {
  const keep = keptContext<Stamped>();
  keep(stamped([1, 2], { exhausted: true }), "/a");
  const live = stamped([1, 2, 3], { exhausted: true });
  expect(keep(live, "/a", tail([1, 2, 3, 4, 5], { exhausted: true }))).toBe(live);
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

type Stamped = ReturnType<typeof stamped>;

/** What `useIterateContext` returns, with events at `offsets` that each have a `createdAt`. */
function stamped(offsets: number[], { caughtUp = true, exhausted = false }) {
  return {
    events: offsets.map((offset) => stampedEvent(offset)),
    caughtUp,
    error: undefined as string | undefined,
    head: offsets.at(-1) || 0,
    older: { loadOlder() {}, loading: !caughtUp, exhausted },
    processors: { loaded: caughtUp },
    liveState: { agent: { status: "live" } } as Record<string, { status: string }>,
  };
}

/** A saved tail of events at `offsets`, as `#/lib/saved-log-tail.ts` reads it back. */
function tail(offsets: number[], { exhausted }: { exhausted: boolean }) {
  return { events: offsets.map((offset) => stampedEvent(offset)), exhausted };
}

function stampedEvent(offset: number) {
  return { offset, createdAt: `t${offset}`, ephemeral: undefined as boolean | undefined };
}
