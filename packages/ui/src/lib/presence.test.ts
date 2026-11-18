// @vitest-environment jsdom
// presence.test.ts — who is here now (presence.ts): the pages from the subscriptions table and the
// lent stubs alone, and each page's status: whose it may be (the platform's stamp, the row's
// holder), typing on the mind's clock, when a page says its status, and a page's rows read again.
// The chat's line is multiplayer.test.tsx's.
import { expect, test, vi } from "vitest";
import {
  connectPresence,
  hereOf,
  type PresenceEvent,
  type PresencePage,
  type PresencePrincipal,
  type PresenceRow,
} from "./presence.ts";

const ADA = { actor: "/members/ada", email: "ada@example.com" };
const BOB = { actor: "/members/bob", email: "bob@example.com" };
const CY = { actor: "/members/cy", email: "cy@example.com" };
const GUEST = { actor: "user_9", name: "Gil", kind: "guest" as const };

test.for<{
  name: string;
  rows: PresenceRow[];
  lent: string[];
  me: string | undefined;
  expected: unknown[];
}>([
  {
    name: "a row whose stub is lent, held through an app's page, is a face",
    rows: [row("bob-1", BOB)],
    lent: ["bob-1"],
    me: undefined,
    expected: [{ ...BOB, pages: ["bob-1"], me: false }],
  },
  {
    name: "an orphaned row (its stub is lent no more) is nobody",
    rows: [row("bob-1", BOB)],
    lent: [],
    me: undefined,
    expected: [],
  },
  {
    name: "a row with no heldBy (a platform that does not say it) is nobody",
    rows: [row("bob-1", undefined)],
    lent: ["bob-1"],
    me: undefined,
    expected: [],
  },
  {
    name: "a script's or a CLI's row (no via) is nobody",
    rows: [row("bob-1", BOB, { via: false })],
    lent: ["bob-1"],
    me: undefined,
    expected: [],
  },
  {
    name: "two pages of one principal are one face; a live state's row of the same page is no page",
    rows: [
      row("bob-1", BOB),
      row("bob-2", BOB),
      row("bob-1-agent", BOB, { consumes: ["events.iterate.com/itx/live-state-changed"] }),
    ],
    lent: ["bob-1", "bob-2", "bob-1-agent"],
    me: undefined,
    expected: [{ ...BOB, pages: ["bob-1", "bob-2"], me: false }],
  },
  {
    name: "the viewer by their actor id is last and marked",
    rows: [row("ada-1", ADA), row("bob-1", BOB)],
    lent: ["ada-1", "bob-1"],
    me: ADA.actor,
    expected: [
      { ...BOB, me: false },
      { ...ADA, me: true },
    ],
  },
  {
    name: "the viewer by their address, in another case, is last and marked",
    rows: [row("ada-1", ADA), row("bob-1", BOB)],
    lent: ["ada-1", "bob-1"],
    me: "ADA@example.com",
    expected: [
      { ...BOB, me: false },
      { ...ADA, me: true },
    ],
  },
])("$name", ({ rows, lent, me, expected }) => {
  expect(hereOf(rows, lent.map(stubKeyOf), me)).toMatchObject(expected);
  expect(hereOf(rows, lent.map(stubKeyOf), me)).toHaveLength(expected.length);
});

test("a row that goes takes its face and its status with it at once, with no timer", () => {
  using page = viewer();
  page.see([row("bob-1", BOB)]);
  page.take([status(BOB, "bob-1", { away: true, typing: true })]);
  expect(page.presence.get()).toMatchObject([{ actor: BOB.actor, state: "away", typing: true }]);
  page.see([]);
  expect(page.presence.get()).toEqual([]);
  // the same name again is a new page: the status of the one that went is not its own
  page.see([row("bob-1", BOB)]);
  expect(page.presence.get()).toMatchObject([{ actor: BOB.actor }]);
});

test("a status counts only when the platform's stamp is the principal who holds the row it names", () => {
  using page = viewer();
  page.see([row("bob-1", BOB)]);
  page.take([
    // Cy's own session names Bob's row
    status(CY, "bob-1", { away: true, typing: true }),
    // Bob's words, but appended for him by code, by a schedule, by a copy, by the platform, or with no stamp
    { ...status(BOB, "bob-1", { typing: true }), source: { onBehalfOf: { principal: BOB } } },
    {
      ...status(BOB, "bob-1", { typing: true }),
      source: { principal: BOB, onBehalfOf: { principal: CY } },
    },
    {
      ...status(BOB, "bob-1", { typing: true }),
      source: { principal: BOB, schedule: { key: "k" } },
    },
    {
      ...status(BOB, "bob-1", { typing: true }),
      source: { principal: BOB, copiedFrom: { path: "/a", offset: 1 } },
    },
    { ...status(BOB, "bob-1", { typing: true }), source: { principal: BOB, platform: true } },
    { ...status(BOB, "bob-1", { typing: true }), source: { origin: "/" } },
    // Bob's own status for a row that is gone
    status(BOB, "bob-gone", { away: true, typing: true }),
  ]);
  expect(page.presence.get()).toMatchObject([{ actor: BOB.actor, state: "active", typing: false }]);
  page.take([...page.taken, status(BOB, "bob-1", { away: true })]);
  expect(page.presence.get()).toMatchObject([{ actor: BOB.actor, state: "away", typing: false }]);
});

// A person who is no member reaches the chat through a one-context view, whose appends the
// platform stamps `onBehalfOf` the person, `via` the app's page, with no `run` and no `call`
// (core/itx person-context.ts).
test("a person's status from their one-context view counts for the row they hold", () => {
  using page = viewer();
  page.see([row("bob-1", BOB), row("guest-1", GUEST)]);
  page.take([viewStatus(GUEST, "guest-1", { away: true, typing: true, marks: ["voice"] })]);
  expect(page.presence.get()).toMatchObject([
    { actor: BOB.actor, state: "active", typing: false, marks: [] },
    { actor: GUEST.actor, state: "away", typing: true, marks: ["voice"] },
  ]);
});

test("a person's status counts only when the stamp is the holder's view, for the row they hold", () => {
  using page = viewer();
  page.see([row("bob-1", BOB), row("guest-1", GUEST)]);
  const said = viewStatus(GUEST, "guest-1", { away: true, typing: true });
  const onBehalfOf = { principal: GUEST, via: { appPage: "chat" } };
  page.take([
    // code that ran for the guest, a facet's call for them, an append with no app page
    { ...said, source: { origin: "/", onBehalfOf: { ...onBehalfOf, run: "/agents/a@4" } } },
    { ...said, source: { origin: "/", onBehalfOf: { ...onBehalfOf, call: "/agents/a#agent.x" } } },
    { ...said, source: { origin: "/", onBehalfOf: { principal: GUEST } } },
    // a member's session that also names the guest
    { ...said, source: { origin: "/", principal: BOB, onBehalfOf } },
    // the guest's view names Bob's row
    viewStatus(GUEST, "bob-1", { away: true, typing: true }),
  ]);
  expect(page.presence.get()).toMatchObject([
    { actor: BOB.actor, state: "active", typing: false },
    { actor: GUEST.actor, state: "active", typing: false },
  ]);
});

test("one principal is away only when every page of theirs is; the marks of each page are theirs", () => {
  using page = viewer();
  page.see([row("bob-1", BOB), row("bob-2", BOB)]);
  page.take([status(BOB, "bob-1", { away: true, marks: ["voice", "camera"] })]);
  expect(page.presence.get()).toMatchObject([
    { actor: BOB.actor, pages: 2, state: "active", marks: ["voice", "camera"] },
  ]);
  page.take([...page.taken, status(BOB, "bob-2", { away: true })]);
  expect(page.presence.get()).toMatchObject([{ actor: BOB.actor, state: "away" }]);
});

test("typing ends 6 s after the last status said it, on the mind's clock, and a late status is as old as it is", async () => {
  using page = viewer();
  page.see([row("bob-1", BOB), row("cy-1", CY)]);
  page.take([status(BOB, "bob-1", { typing: true })]);
  await vi.advanceTimersByTimeAsync(5_990);
  expect(page.presence.get()).toMatchObject([
    { actor: BOB.actor, typing: true },
    { actor: CY.actor },
  ]);
  await vi.advanceTimersByTimeAsync(20);
  expect(page.presence.get()).toMatchObject([
    { actor: BOB.actor, typing: false },
    { actor: CY.actor },
  ]);
  // the tab was hidden: Cy's typing of 18 minutes ago comes with what is newer
  const long = Date.now();
  await vi.advanceTimersByTimeAsync(18 * 60_000);
  page.take([
    ...page.taken,
    status(CY, "cy-1", { typing: true, at: long }),
    status(BOB, "bob-1", {}),
  ]);
  expect(page.presence.get()).toMatchObject([
    { actor: BOB.actor, typing: false },
    { actor: CY.actor, typing: false },
  ]);
});

test("typing that was heard ends 6 s after it was said while the page's own row is gone, and after it comes back", async () => {
  using page = viewer();
  page.see([row("bob-1", BOB)]);
  page.take([status(BOB, "bob-1", { typing: true })]);
  page.presence.start(page.send, "ada-1");
  // the page's socket closed: its row went, and the page says nothing
  page.presence.stop();
  await vi.advanceTimersByTimeAsync(6_010);
  const typing = [page.presence.get()];
  // a new session gave the page another row
  page.presence.start(page.send, "ada-2");
  page.take([...page.taken, status(BOB, "bob-1", { typing: true })]);
  await vi.advanceTimersByTimeAsync(6_010);
  typing.push(page.presence.get());
  expect(typing).toMatchObject([[{ typing: false }], [{ typing: false }]]);
});

test("what a principal writes by their own hand ends the typing they said before it, a status of the same instant too; a newer one says it again", () => {
  using page = viewer();
  page.see([row("bob-1", BOB)]);
  const at = Date.now();
  const typing: boolean[] = [];
  for (const event of [
    status(BOB, "bob-1", { typing: true, at: at - 3_000 }),
    // his script's words, a schedule he set, Cy's words: not his hand
    written({ onBehalfOf: { principal: BOB, run: "/agents/a@4" } }, at - 2_000),
    written({ principal: BOB, schedule: { key: "k" } }, at - 2_000),
    written({ principal: CY }, at - 2_000),
    // his message, through his own session
    written({ principal: BOB }, at - 1_000),
    status(BOB, "bob-1", { typing: true, at: at - 1_000 }),
    status(BOB, "bob-1", { typing: true, at }),
  ]) {
    page.take([...page.taken, event]);
    typing.push(page.presence.get()[0]!.typing);
  }
  expect(typing).toEqual([true, true, true, true, false, false, true]);
});

test("the viewer's own words let the next key say typing at once, within the 3 s it waits otherwise", async () => {
  using page = viewer();
  page.presence.start(page.send, "ada-1");
  page.presence.typing(true);
  await vi.advanceTimersByTimeAsync(500);
  page.take([written({ principal: ADA }, Date.now())]);
  page.presence.typing(true);
  await vi.advanceTimersByTimeAsync(0);
  expect(page).toMatchObject({ sent: [sent({ typing: true }), sent({ typing: true })] });
});

test("a page whose clock is ahead of the mind's still shows a fresh status as typing", () => {
  using page = viewer();
  page.see([row("bob-1", BOB)]);
  // the mind's clock is 10 minutes behind the page's
  page.take([status(BOB, "bob-1", { typing: true, at: Date.now() - 10 * 60_000 })]);
  expect(page.presence.get()).toMatchObject([{ actor: BOB.actor, typing: true }]);
});

test("typing is said at most once in 3 s while the person writes, and once when they stop", async () => {
  using page = viewer();
  page.presence.start(page.send, "ada-1");
  for (let key = 0; key < 5; key++) {
    page.presence.typing(true);
    await vi.advanceTimersByTimeAsync(500);
  }
  expect(page.sent.map((event) => event.payload.typing)).toEqual([true]);
  await vi.advanceTimersByTimeAsync(1_000);
  page.presence.typing(true);
  await vi.advanceTimersByTimeAsync(0);
  page.presence.typing(false);
  page.presence.typing(false);
  await vi.advanceTimersByTimeAsync(0);
  // what is said: the page's own row and its state, and no name
  expect(page).toMatchObject({
    sent: [sent({ typing: true }), sent({ typing: true }), sent({ typing: false })],
  });
  expect(JSON.stringify(page.sent)).not.toMatch(/ada@|example\.com|members/);
});

test("a page says its status once, soon, when another principal's page appears, and when it is hidden or its marks change", async () => {
  using page = viewer();
  page.presence.start(page.send, "ada-1");
  // its own row, and another page of its own, ask for nothing
  page.see([row("ada-1", ADA), row("ada-2", ADA)]);
  await vi.advanceTimersByTimeAsync(400);
  expect(page).toMatchObject({ sent: [] });
  // Bob and Cy arrive in one read: one status within 400 ms
  page.see([row("ada-1", ADA), row("bob-1", BOB), row("cy-1", CY)]);
  page.see([row("ada-1", ADA), row("bob-1", BOB), row("cy-1", CY)]);
  await vi.advanceTimersByTimeAsync(400);
  expect(page).toMatchObject({ sent: [sent({})] });
  page.hide();
  page.presence.mark(["voice"]);
  page.presence.mark(["voice"]);
  await vi.advanceTimersByTimeAsync(0);
  expect(page).toMatchObject({
    sent: [sent({}), sent({ away: true }), sent({ away: true, marks: ["voice"] })],
  });
});

test("a page that went and came back under the same name hears this page's status again", async () => {
  using page = viewer();
  page.presence.start(page.send, "ada-1");
  page.see([row("ada-1", ADA), row("bob-1", BOB)]);
  await vi.advanceTimersByTimeAsync(400);
  page.see([row("ada-1", ADA)]);
  page.see([row("ada-1", ADA), row("bob-1", BOB)]);
  await vi.advanceTimersByTimeAsync(400);
  expect(page).toMatchObject({ sent: [sent({}), sent({})] });
});

test("a page that does not know its own row says nothing, and still shows who is here", async () => {
  using page = viewer();
  page.see([row("bob-1", BOB)]);
  page.presence.typing(true);
  page.hide();
  await vi.advanceTimersByTimeAsync(1_000);
  expect(page).toMatchObject({ sent: [] });
  expect(page.presence.get()).toMatchObject([{ actor: BOB.actor }]);
});

test("a new array of the same events (a reconnect) gives the same picture, and folds nothing twice", () => {
  using page = viewer();
  const heard = vi.fn();
  page.presence.subscribe(heard);
  page.see([row("bob-1", BOB), row("cy-1", CY)]);
  const events = [status(BOB, "bob-1", { away: true }), status(CY, "cy-1", { typing: true })];
  page.take(events);
  const before = page.presence.get();
  const calls = heard.mock.calls.length;
  page.take([...events]);
  expect(heard).toHaveBeenCalledTimes(calls);
  page.take(structuredClone(events));
  expect(page.presence.get()).toEqual(before);
});

/** A row of the subscriptions table as the platform lists it: a live callback held by
 *  `principal` through an app's page (`via`), consuming the chat's types unless told. */
function row(
  name: string,
  principal: PresencePrincipal | undefined,
  { via = true, consumes = ["*", "presence/status"] }: { via?: boolean; consumes?: string[] } = {},
): PresenceRow {
  return {
    name,
    target: `itx.builtins.rpcStubs.get('${stubKeyOf(name)}')`,
    consumes,
    ...(principal && { heldBy: { principal, ...(via && { via: { appPage: "dash" } }) } }),
  };
}

/** The key of the stub a page lends for its row `name`. */
function stubKeyOf(name: string) {
  return `subscription:${name}`;
}

/** A `presence/status` as the platform commits it: stamped with whose session appended it, at
 *  `at` on the mind's clock (default now). */
function status(
  principal: { actor: string; email: string },
  subscription: string,
  {
    at = Date.now(),
    away = false,
    typing = false,
    marks,
  }: { at?: number; away?: boolean; typing?: boolean; marks?: string[] },
): PresenceEvent {
  return {
    type: "presence/status",
    createdAt: new Date(at).toISOString(),
    payload: { subscription, away, typing, marks },
    source: { origin: "/", principal },
  };
}

/** An event of the log (a message) as the platform commits it under `source`, at `at` on the mind's
 *  clock. */
function written(source: Record<string, unknown>, at: number): PresenceEvent {
  return {
    type: "events.iterate.com/agent/context-added",
    createdAt: new Date(at).toISOString(),
    payload: { role: "user", content: "hello" },
    source: { origin: "/", ...source },
  };
}

/** A `presence/status` as the platform commits it from a person's one-context view: stamped
 *  `onBehalfOf` the person, through the app's page, with no `run` and no `call`. */
function viewStatus(
  principal: PresencePrincipal,
  subscription: string,
  state: { away?: boolean; typing?: boolean; marks?: string[] },
): PresenceEvent {
  return {
    type: "presence/status",
    createdAt: new Date().toISOString(),
    payload: { subscription, away: false, typing: false, ...state },
    source: { origin: "/", onBehalfOf: { principal, via: { appPage: "chat" } } },
  };
}

type Sent = { type: string; ephemeral: true; payload: Record<string, unknown> };

/** What Ada's page sends from its row `ada-1`. */
function sent(state: { away?: boolean; typing?: boolean; marks?: string[] }): Sent {
  return {
    type: "presence/status",
    ephemeral: true,
    payload: { subscription: "ada-1", away: false, typing: false, ...state },
  };
}

/** Ada's page on Vitest's clock: what it sends is kept, `see` takes rows whose stubs are all lent,
 *  `take` keeps the array it was given, and `hide` hides the page. Disposing stops it and gives
 *  the clock back. */
function viewer() {
  vi.useFakeTimers();
  let visible = true;
  let changed = () => {};
  const page: PresencePage = {
    visible: () => visible,
    watch(onChanged) {
      changed = onChanged;
      return () => {};
    },
  };
  const presence = connectPresence({ me: ADA.actor, page });
  const sent: Sent[] = [];
  const taken: PresenceEvent[] = [];
  const held = {
    presence,
    sent,
    taken,
    send: (event: Sent) => void sent.push(event),
    see: (rows: PresenceRow[]) =>
      presence.see(
        rows,
        rows.map((each) => stubKeyOf(each.name)),
      ),
    take(events: PresenceEvent[]) {
      held.taken = events;
      presence.take(events);
    },
    hide() {
      visible = false;
      changed();
    },
    [Symbol.dispose]() {
      presence.close();
      vi.useRealTimers();
    },
  };
  return held;
}
