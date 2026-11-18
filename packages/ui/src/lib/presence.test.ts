// @vitest-environment jsdom
// presence.test.ts — who is here now (presence.ts): whose a seat is (the platform's stamp alone),
// several pages of one principal, a reload and a duplicated tab, a page that goes without a word,
// typing, the mind's clock against events that arrive late, a page's rows read again, and what one
// page's seat sends and when. jsdom gives the browser's page events and session storage.
import { expect, test, vi } from "vitest";
import {
  connectPresence,
  observePresence,
  presentOf,
  PRESENCE_GONE,
  PRESENCE_HERE,
  type PresenceEvent,
  type PresencePage,
  type PresenceSeats,
} from "./presence.ts";

const ADA = { actor: "user_ada", email: "ada@example.com" };
const BOB = { actor: "user_bob", email: "bob@example.com" };

test("a seat is its principal's by the platform's stamp alone: a name in the payload, an event code appended for someone, and an event with no stamp are nobody's", () => {
  let seats: PresenceSeats = new Map();
  const take = (event: PresenceEvent) => (seats = observePresence(seats, event).seats);
  // Ada's own session, with a payload that claims to be Bob
  take({
    ...here(ADA, "s1", "t1", { at: 1_000 }),
    payload: {
      seat: "s1",
      tab: "t1",
      state: "active",
      typing: false,
      email: BOB.email,
      actor: BOB.actor,
    },
  });
  // a script that ran for Bob, Bob's stamp with an `onBehalfOf`, and the mind's own code
  take({
    ...here(BOB, "s2", "t2", { at: 1_000 }),
    source: { onBehalfOf: { principal: BOB, run: "/@7" } },
  });
  take({
    ...here(BOB, "s5", "t5", { at: 1_000 }),
    source: { principal: BOB, onBehalfOf: { principal: ADA, run: "/@8" } },
  });
  take({ ...here(BOB, "s3", "t3", { at: 1_000 }), source: { origin: "/" } });
  take({ ...here(BOB, "s4", "t4", { at: 1_000 }), source: undefined });
  expect(presentOf(seats, 1_000, undefined)).toEqual([
    { ...ADA, seats: 1, state: "active", typing: false, me: false },
  ]);
});

test("several pages of one principal are one face: active when one of them is in view, typing when one of them types", () => {
  let seats: PresenceSeats = new Map();
  for (const event of [
    here(ADA, "phone", "t-phone", { state: "away", at: 0 }),
    here(ADA, "laptop", "t-laptop", { typing: true, at: 0 }),
    here(BOB, "desk", "t-desk", { at: 0 }),
  ])
    seats = observePresence(seats, event).seats;
  // the reader last, the others by their address; `me` may be the reader's address
  expect(presentOf(seats, 1, BOB.email)).toEqual([
    { ...ADA, seats: 2, state: "active", typing: true, me: false },
    { ...BOB, seats: 1, state: "active", typing: false, me: true },
  ]);
});

test("a reload is the same tab with a new seat, which replaces the old one; gone removes a seat, and only its own principal's", () => {
  let seats: PresenceSeats = new Map();
  const take = (event: PresenceEvent) => (seats = observePresence(seats, event).seats);
  take(here(ADA, "before", "tab-1", { at: 0 }));
  take(here(ADA, "after", "tab-1", { at: 2_000 }));
  expect(presentOf(seats, 2_000, undefined)).toMatchObject([{ actor: ADA.actor, seats: 1 }]);
  // Bob names Ada's seat: nothing of hers changes
  take(gone(BOB, "after", 3_000));
  expect(presentOf(seats, 3_000, undefined)).toHaveLength(1);
  // a gone older than what the seat said last changes nothing
  take(gone(ADA, "after", 1_000));
  expect(presentOf(seats, 3_000, undefined)).toHaveLength(1);
  take(gone(ADA, "after", 4_000));
  expect(presentOf(seats, 4_000, undefined)).toEqual([]);
});

test("a page that goes without a word is taken for gone by the clock: 45 s for a page in view, 150 s for a hidden one; typing lasts 6 s unsaid", () => {
  let seats: PresenceSeats = new Map();
  seats = observePresence(seats, here(ADA, "s1", "t1", { typing: true, at: 0 })).seats;
  seats = observePresence(seats, here(BOB, "s2", "t2", { state: "away", at: 0 })).seats;
  const at = (now: number) =>
    presentOf(seats, now, undefined).map(({ actor, typing }) => [actor, typing]);
  expect(at(5_999)).toEqual([
    [ADA.actor, true],
    [BOB.actor, false],
  ]);
  expect(at(6_000)).toEqual([
    [ADA.actor, false],
    [BOB.actor, false],
  ]);
  expect(at(45_000)).toEqual([[BOB.actor, false]]);
  expect(at(150_000)).toEqual([]);
});

test("a page's seat: hello at once, a beat every 20 s in view and every 60 s hidden, gone when it gets up, and never a name in what it sends", async () => {
  using _clock = fakeClock();
  const page = fakePage();
  const { seat, sent } = seated(page);
  await vi.advanceTimersByTimeAsync(0);
  expect(sent).toEqual([
    {
      type: PRESENCE_HERE,
      ephemeral: true,
      payload: { seat: "mine", tab: "my-tab", state: "active", typing: false, hello: true },
    },
  ]);
  await vi.advanceTimersByTimeAsync(40_000);
  expect(sent.map(stateOf)).toEqual(["active", "active", "active"]);
  // hidden: said at once, then once a minute
  page.hide();
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(59_000);
  expect(sent.map(stateOf)).toEqual(["active", "active", "active", "away"]);
  await vi.advanceTimersByTimeAsync(1_000);
  expect(sent.map(stateOf).at(-1)).toBe("away");
  expect(sent).toHaveLength(5);
  seat.stop();
  await vi.advanceTimersByTimeAsync(120_000);
  expect(sent.at(-1)).toEqual({ type: PRESENCE_GONE, ephemeral: true, payload: { seat: "mine" } });
  expect(sent).toHaveLength(6);
  // no event of a seat names anyone: the platform's stamp does
  expect(JSON.stringify(sent)).not.toMatch(/ada|example\.com|user_/);
});

test("typing is said at most once in 3 s while the person writes, and once when they stop", async () => {
  using _clock = fakeClock();
  const { seat, sent } = seated(fakePage());
  await vi.advanceTimersByTimeAsync(0);
  const typingSent = () => sent.slice(1).map((event) => event.payload.typing);
  for (let key = 0; key < 5; key++) {
    seat.typing(true);
    await vi.advanceTimersByTimeAsync(500);
  }
  expect(typingSent()).toEqual([true]);
  await vi.advanceTimersByTimeAsync(1_000);
  seat.typing(true);
  await vi.advanceTimersByTimeAsync(0);
  expect(typingSent()).toEqual([true, true]);
  seat.typing(false);
  seat.typing(false);
  await vi.advanceTimersByTimeAsync(0);
  expect(typingSent()).toEqual([true, true, false]);
  seat.stop();
});

test("a seat answers another seat's arrival once, soon, and not its own; what it hears is published when it changes, and again when a seat's time runs out", async () => {
  using _clock = fakeClock();
  const { seat, sent } = seated(fakePage());
  await vi.advanceTimersByTimeAsync(0);
  const heard = vi.fn();
  seat.subscribe(heard);
  // its own hello comes back through the subscription: no answer, and the reader is here
  const log = [here(ADA, "mine", "my-tab", { hello: true })];
  seat.take(log);
  await vi.advanceTimersByTimeAsync(400);
  expect(sent).toHaveLength(1);
  expect(seat.get()).toMatchObject([{ actor: ADA.actor, me: true }]);
  // Bob arrives, twice in one batch: one answer within 400 ms
  log.push(
    here(BOB, "his", "his-tab", { hello: true }),
    here(BOB, "his", "his-tab", { hello: true }),
  );
  seat.take([...log]);
  expect(seat.get().map((principal) => principal.actor)).toEqual([BOB.actor, ADA.actor]);
  await vi.advanceTimersByTimeAsync(400);
  expect(sent.map((event) => event.payload.hello)).toEqual([true, undefined]);
  // the same array again: nothing is folded twice, and nothing is published
  const calls = heard.mock.calls.length;
  seat.take([...log]);
  expect(heard).toHaveBeenCalledTimes(calls);
  // Bob's page vanishes, and the reader's own beat goes on: 45 s after his last beat he is
  // gone, with no event at all
  await vi.advanceTimersByTimeAsync(30_000);
  log.push(here(ADA, "mine", "my-tab"));
  seat.take([...log]);
  await vi.advanceTimersByTimeAsync(16_000);
  expect(seat.get().map((principal) => principal.actor)).toEqual([ADA.actor]);
  seat.stop();
});

test("a new array of rows (a reconnect) is read again from its start: the same events count again, and a new one counts too", async () => {
  using _clock = fakeClock();
  const { seat, sent } = seated(fakePage());
  await vi.advanceTimersByTimeAsync(0);
  const before = [here(ADA, "mine", "my-tab"), here(BOB, "his", "his-tab", { hello: true })];
  seat.take(before);
  await vi.advanceTimersByTimeAsync(400);
  expect(sent).toHaveLength(2);
  await vi.advanceTimersByTimeAsync(10_000);
  // a new session hands the same events again as new objects, and fewer of them, then Bob types
  seat.take([structuredClone(before[1]!), here(BOB, "his", "his-tab", { typing: true })]);
  expect(seat.get()).toMatchObject([{ actor: BOB.actor, typing: true }]);
  // Bob's hello is 10 s old now: it is not answered a second time
  await vi.advanceTimersByTimeAsync(400);
  expect(sent).toHaveLength(2);
  seat.stop();
});

test("events that arrive late are as old as they are: no face for a page gone 15 minutes ago, no typing of 18 minutes ago, no answer to an old hello", async () => {
  using _clock = fakeClock();
  const { seat, sent } = seated(fakePage());
  await vi.advanceTimersByTimeAsync(0);
  const log = [here(ADA, "mine", "my-tab")];
  seat.take(log);
  const long = Date.now();
  // the tab is hidden for 18 minutes and gets nothing; then everything comes at once
  await vi.advanceTimersByTimeAsync(18 * 60_000);
  const sentBefore = sent.length;
  log.push(
    here(BOB, "his", "his-tab", { typing: true, hello: true, at: long }),
    here(BOB, "his", "his-tab", { at: long + 3 * 60_000 }),
    here(ADA, "mine", "my-tab"),
  );
  seat.take([...log]);
  expect(seat.get()).toMatchObject([{ actor: ADA.actor, me: true }]);
  expect(seat.get()).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(400);
  expect(sent).toHaveLength(sentBefore);
  seat.stop();
});

test("a page whose clock is ahead of the mind's still sees who is here and answers a fresh hello", async () => {
  using _clock = fakeClock();
  const { seat, sent } = seated(fakePage());
  await vi.advanceTimersByTimeAsync(0);
  // the mind's clock is 10 minutes behind the page's: Bob's beat is fresh on the mind's clock
  const mind = Date.now() - 10 * 60_000;
  seat.take([
    here(ADA, "mine", "my-tab", { at: mind }),
    here(BOB, "his", "his-tab", { hello: true, at: mind }),
  ]);
  expect(seat.get()).toMatchObject([{ actor: BOB.actor }, { actor: ADA.actor }]);
  await vi.advanceTimersByTimeAsync(400);
  expect(sent).toHaveLength(2);
  seat.stop();
});

test("a duplicated tab has a tab id of its own; a reload keeps the tab's id", async () => {
  sessionStorage.setItem("iterate:presence-tab", "first-tab");
  const tabOf = async (navigation: string) => {
    vi.spyOn(performance, "getEntriesByType").mockReturnValue([navigationOf(navigation)]);
    const sent: Sent[] = [];
    const seat = connectPresence({ me: ADA.actor, page: fakePage() });
    seat.start((event) => void sent.push(event));
    seat.stop();
    await vi.waitFor(() => expect(sent).toHaveLength(2));
    return sent[0]?.payload.tab;
  };
  expect(await tabOf("reload")).toBe("first-tab");
  // a duplicate copies the session storage, but it is no reload
  const duplicate = await tabOf("navigate");
  expect(duplicate).not.toBe("first-tab");
  expect(sessionStorage.getItem("iterate:presence-tab")).toBe(duplicate);
});

test("pagehide of a page the browser keeps (back-forward cache, a phone's app in the background) is no gone; of a page that closes, it is", async () => {
  const sent: Sent[] = [];
  const seat = connectPresence({ me: ADA.actor, ids: { seat: "mine", tab: "my-tab" } });
  seat.start((event) => void sent.push(event));
  window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
  await vi.waitFor(() => expect(sent).toHaveLength(1));
  window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false }));
  await vi.waitFor(() =>
    expect(sent.map((event) => event.type)).toEqual([PRESENCE_HERE, PRESENCE_GONE]),
  );
  // a browser hides the page right after: the seat that left does not say "here, away"
  const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  document.dispatchEvent(new Event("visibilitychange"));
  await new Promise((done) => setTimeout(done, 20));
  expect(sent.map((event) => event.type)).toEqual([PRESENCE_HERE, PRESENCE_GONE]);
  visibility.mockRestore();
  seat.stop();
});

test("a seat that got up and sits down again in a hidden page says that it is here", async () => {
  const page = fakePage();
  const { seat, sent } = seated(page);
  page.hide();
  seat.stop();
  seat.start((event) => void sent.push(event));
  await vi.waitFor(() =>
    expect(sent.map((event) => [event.type, stateOf(event), event.payload.hello])).toEqual([
      [PRESENCE_HERE, "active", true],
      [PRESENCE_HERE, "away", undefined],
      [PRESENCE_GONE, undefined, undefined],
      [PRESENCE_HERE, "away", true],
    ]),
  );
  seat.stop();
});

/** A `presence/here` as the platform commits it: the stamp says whose session appended it, and
 *  `createdAt` is the mind's clock (`at`, default now). */
function here(
  principal: { actor: string; email: string },
  seat: string,
  tab: string,
  {
    at = Date.now(),
    ...more
  }: { state?: "active" | "away"; typing?: boolean; hello?: boolean; at?: number } = {},
): PresenceEvent {
  return {
    type: PRESENCE_HERE,
    createdAt: new Date(at).toISOString(),
    payload: { seat, tab, state: "active", typing: false, ...more },
    source: { origin: "/", principal },
  };
}

function gone(
  principal: { actor: string; email: string },
  seat: string,
  at: number,
): PresenceEvent {
  return {
    type: PRESENCE_GONE,
    createdAt: new Date(at).toISOString(),
    payload: { seat },
    source: { origin: "/", principal },
  };
}

/** The browser's entry for how this page was loaded: "navigate", "reload", "back_forward". */
function navigationOf(type: string): PerformanceEntry {
  // The cast: the seat reads only `type`; a whole PerformanceNavigationTiming has 30 more fields.
  return { type } as unknown as PerformanceEntry;
}

/** A page that a test hides. */
function fakePage(): PresencePage & { hide(): void } {
  let visible = true;
  let changed = () => {};
  return {
    visible: () => visible,
    watch(onChanged) {
      changed = onChanged;
      return () => {};
    },
    hide() {
      visible = false;
      changed();
    },
  };
}

type Sent = { type: string; ephemeral: true; payload: Record<string, unknown> };
const stateOf = (event: Sent) => event.payload.state;

/** Ada's seat, started, with everything it sends kept. Its own events are fed back by the test. */
function seated(page: PresencePage) {
  const sent: Sent[] = [];
  const seat = connectPresence({
    me: ADA.actor,
    page,
    ids: { seat: "mine", tab: "my-tab" },
  });
  seat.start((event) => void sent.push(event));
  return { seat, sent };
}

/** Vitest's clock for one test, which a `using` gives back. */
function fakeClock() {
  vi.useFakeTimers();
  return { [Symbol.dispose]: () => void vi.useRealTimers() };
}
