// Folding the log for reading: days, and runs (events in a row of one type, or of the stream's
// upkeep). The fixture's two days sit 48 h apart at noon UTC, so they are two local days in every
// timezone.
import { expect, test } from "vitest";

import {
  foldEvents,
  growthOf,
  lastEventOf,
  refold,
  whoBefore,
  type FeedItem,
  type Fold,
} from "./folds.tsx";
import {
  filterEvents,
  recount,
  refilter,
  runLabel,
  typeCounts,
  type Filtered,
  type TypeCounts,
} from "./filters.tsx";
import type { ContextViewEvent } from "./types.tsx";

const log: ContextViewEvent[] = [
  at(1, "events.iterate.com/itx/created", { path: "/" }),
  at(2, "events.iterate.com/itx/woken", { incarnation: 1 }),
  at(3, "events.iterate.com/itx/subscription-configured", { name: "account" }),
  at(4, "events.iterate.com/account/authenticated", { credential: "cookie" }),
  at(5, "events.iterate.com/account/authenticated", { credential: "cookie" }),
  at(6, "events.iterate.com/account/authenticated", { credential: "cookie" }),
  at(7, "events.iterate.com/account/authenticated", { credential: "admin-secret" }),
  at(8, "events.iterate.com/itx/woken", { incarnation: 2 }, "2026-09-23T12:00:00.000Z"),
  at(
    9,
    "events.iterate.com/itx/subscription-configured",
    { name: "sub-1" },
    "2026-09-23T12:00:00.000Z",
  ),
  at(10, "events.iterate.com/itx/live-state-changed", undefined, "2026-09-23T12:00:01.000Z"),
  at(
    11,
    "events.iterate.com/account/personal-access-token-minted",
    { id: "pat_a" },
    "2026-09-23T12:00:02.000Z",
  ),
];

// ── foldEvents ──
test("a day mark, a run of upkeep as one item, and events in a row of one type as one item whatever their payloads", () => {
  const items = foldEvents(log);
  expect(items.map(shape)).toEqual([
    "day:Mon Sep 21 2026",
    "event:1 1", // itx/created
    "run:2 2,3", // itx/woken, itx/subscription-configured: upkeep, two types
    "run:4 4,5,6,7", // account/authenticated ×4, the last with another credential
    "day:Wed Sep 23 2026",
    "run:8 8,9,10", // woken, subscription, live state
    "event:11 11",
  ]);
});
test("one event of upkeep stays a row of its own, and a run never crosses a day", () => {
  expect(foldEvents([log[0]!, log[1]!, log[3]!]).map((item) => item.kind)).toEqual([
    "day",
    "event",
    "event",
    "event",
  ]);
  expect(foldEvents([log[1]!, log[7]!]).map((item) => item.kind)).toEqual([
    "day",
    "event",
    "day",
    "event",
  ]);
});
test("a run of one type does not take in upkeep, nor a run of upkeep an event that is not", () => {
  const mixed = [
    at(1, "t.example.com/a", {}),
    at(2, "t.example.com/a", {}),
    at(3, "events.iterate.com/itx/woken", {}),
    at(4, "t.example.com/a", {}),
    at(5, "t.example.com/b", {}),
  ];
  expect(foldEvents(mixed).map(shape).slice(1)).toEqual([
    "run:1 1,2",
    "event:3 3",
    "event:4 4",
    "event:5 5",
  ]);
});
test("lastEventOf anchors the next gap at the end of a run", () => {
  const items = foldEvents(log);
  expect(lastEventOf(items[3])?.offset).toBe(7);
  expect(lastEventOf(items[0])).toBeUndefined();
});

test("a run's line names its types as they are stored, in order, with a count for each that repeats", () => {
  expect(runLabel([log[1]!, log[2]!, log[7]!, log[8]!, log[9]!].map((e) => e.type))).toBe(
    "itx/woken ×2, itx/subscription-configured ×2, itx/live-state-changed",
  );
  expect(
    runLabel(Array.from({ length: 4 }, () => "events.iterate.com/account/authenticated")),
  ).toBe("account/authenticated ×4");
  // a type of an app's own is shown whole
  expect(runLabel(["t.example.com/a", "t.example.com/a"])).toBe("t.example.com/a ×2");
});

test("an agent keeping warm is upkeep, however long the call", () => {
  const kept = [
    at(1, "events.iterate.com/agent/warm-up-requested", {}),
    at(2, "events.iterate.com/agent/cache-kept-warm", { afterRequestOffset: 1 }),
    at(3, "events.iterate.com/agent/warm-up-requested", {}),
    at(4, "events.iterate.com/agent/cache-kept-warm", { afterRequestOffset: 3 }),
    at(5, "events.iterate.com/agent/idle-check", { afterRequestOffset: 1 }),
  ];
  expect(foldEvents(kept).map(shape).slice(1)).toEqual(["run:1 1,2,3,4,5"]);
  expect(runLabel(kept.map((event) => event.type))).toBe(
    "agent/warm-up-requested ×2, agent/cache-kept-warm ×2, agent/idle-check",
  );
});

test("warming that stopped is news, not upkeep: it is no part of the upkeep before it", () => {
  const kept = [
    at(1, "events.iterate.com/agent/warm-up-requested", {}),
    at(2, "events.iterate.com/agent/idle-check", { afterRequestOffset: 1 }),
    at(3, "events.iterate.com/agent/cache-kept-warm", { stopped: "missed" }),
    at(4, "events.iterate.com/agent/idle-check", { afterRequestOffset: 1 }),
  ];
  expect(foldEvents(kept).map(shape).slice(1)).toEqual(["run:1 1,2", "event:3 3", "event:4 4"]);
});

test("whoBefore: carries the last named actor over upkeep, starts afresh at a day mark", () => {
  const named = (offset: number, actor: string, iso?: string): ContextViewEvent => ({
    // a type of its own each, so that none folds into the one before it
    ...at(offset, `t.example.com/did-${String(offset)}`, { id: `pat_${String(offset)}` }, iso),
    source: { principal: { actor } },
  });
  const items = foldEvents([
    named(1, "user_a"),
    at(2, "events.iterate.com/itx/woken", { incarnation: 2 }),
    named(3, "user_a"),
    named(4, "user_b"),
    named(5, "user_b", "2026-09-23T12:00:00.000Z"),
  ]);
  expect(items.map((item) => item.kind)).toEqual([
    "day",
    "event",
    "event",
    "event",
    "event",
    "day",
    "event",
  ]);
  expect(whoBefore(items, (e) => e.source?.principal?.actor || "")).toEqual([
    "",
    "",
    "user_a",
    "user_a",
    "user_a",
    "",
    "",
  ]);
  // so: #1 named (first), woke unnamed, #3 not named again (still user_a), #4 named (changed), #5 named (new day)
});

// ── the incremental passes equal the whole ones ──
// A log of runs (one type in a row, upkeep, lone events, actors changing hands) across three days,
// grown the way the SDK's log grows: the newest page first, then older pages prepended and live
// events appended, a few at a time, with ends that split runs and days. After every step the
// incremental fold, filter and type counts must equal the whole passes over the log as it stands.
const grown = growingLog(240);
const growths: {
  name: string;
  /** The first window of the log, [low, high). */
  from: [number, number];
  steps: ("append" | "prepend")[];
  sizes: number[];
}[] = [
  { name: "appends one at a time", from: [0, 1], steps: ["append"], sizes: [1] },
  { name: "prepends one at a time", from: [239, 240], steps: ["prepend"], sizes: [1] },
  {
    name: "pages both ways",
    from: [150, 160],
    steps: ["prepend", "append", "append"],
    sizes: [7, 1, 3, 40],
  },
  {
    name: "big prepends, small appends",
    from: [150, 160],
    steps: ["prepend", "append"],
    sizes: [97, 2],
  },
];
test.for(growths)("refold, refilter, recount: $name", (growth) => {
  const actorOf = (event: ContextViewEvent) => event.source?.principal?.actor || "";
  const filter = {
    query: "",
    types: new Set(["t.example.com/a", "events.iterate.com/itx/woken"]),
  };
  let [low, high] = growth.from;
  let fold: Fold | undefined;
  let filtered: Filtered | undefined;
  let counts: TypeCounts | undefined;
  let filteredFold: Fold | undefined;
  for (let step = 0; low > 0 || high < grown.length; step += 1) {
    const size = growth.sizes[step % growth.sizes.length]!;
    const direction = growth.steps[step % growth.steps.length]!;
    if (direction === "prepend") low = Math.max(0, low - size);
    else high = Math.min(grown.length, high + size);
    // a fresh array each step, as the SDK publishes, holding the same event objects
    const log = grown.slice(low, high);
    fold = refold(fold, log, actorOf);
    const whole = foldEvents(log);
    expect(fold.items.map(shape)).toEqual(whole.map(shape));
    expect(fold).toMatchObject({ namedBefore: whoBefore(whole, actorOf) });
    filtered = refilter(filtered, log, filter);
    expect(filtered.shown.map((e) => e.offset)).toEqual(
      filterEvents(log, filter).map((e) => e.offset),
    );
    filteredFold = refold(filteredFold, filtered.shown, actorOf);
    expect(filteredFold.items.map(shape)).toEqual(foldEvents(filterEvents(log, filter)).map(shape));
    counts = recount(counts, log);
    expect([...counts.counts.entries()].sort()).toEqual(typeCounts(log).sort());
  }
});

// growthOf compares items by identity; distinct strings stand in for distinct events.
test.for([
  { name: "an append", previous: ["a", "b"], next: ["a", "b", "c"], growth: { end: ["c"] } },
  { name: "a prepend", previous: ["b", "c"], next: ["a", "b", "c"], growth: { start: ["a"] } },
  { name: "grew in the middle", previous: ["a", "c"], next: ["a", "b", "c"], growth: null },
  { name: "shrank", previous: ["a", "b", "c"], next: ["a", "b"], growth: null },
  {
    name: "grew at both ends at once",
    previous: ["b", "d"],
    next: ["a", "b", "c", "d"],
    growth: null,
  },
])("growthOf: $name", ({ previous, next, growth }) => {
  expect(growthOf(previous, next)).toEqual(growth);
});

test("growthOf: the same array grew by nothing", () => {
  const same = ["a", "b"];
  expect(growthOf(same, same)).toEqual({ end: [] });
});

/** An item as a line: its kind, key and the offsets it covers. */
function shape(item: FeedItem): string {
  if (item.kind === "day") return item.key;
  const offsets = item.kind === "event" ? [item.event.offset] : item.events.map((e) => e.offset);
  return `${item.key} ${offsets.join(",")}`;
}

/** `count` events over three days: runs of one type, runs of upkeep, lone events, and actors
 *  changing hands every so often. */
function growingLog(count: number): ContextViewEvent[] {
  return Array.from({ length: count }, (_, i) => {
    const day = i < 80 ? "2026-09-21" : i < 170 ? "2026-09-23" : "2026-09-25";
    const iso = `${day}T12:00:${String(i % 60).padStart(2, "0")}.000Z`;
    const k = i % 23;
    const type =
      k < 5
        ? "t.example.com/a" // a run of five of one type
        : k < 9
          ? "events.iterate.com/itx/woken" // upkeep
          : `t.example.com/unique-${String(i)}`;
    const payload = k < 5 ? { same: true } : { i };
    return {
      ...at(i + 1, type, payload, iso),
      ...(i % 11 < 6 && { source: { principal: { actor: i % 3 ? "user_a" : "user_b" } } }),
    };
  });
}

function at(offset: number, type: string, payload?: unknown, iso = "2026-09-21T19:00:00.000Z") {
  return {
    offset,
    type,
    createdAt: iso,
    payload,
  } satisfies ContextViewEvent;
}
