// @vitest-environment jsdom
// A context's log that a reload draws at once (`useSavedContext`): the saved rows while the mind
// reads, a read that asks only for what is newer, and the saved rows kept as the same objects.
// The store is fake-indexeddb, a new database for each test; a reload is a fresh import of the
// hook and the store, whose memory is then gone. The reconnect rules are `keptContext`'s
// (#/lib/itx-session.test.ts).
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { useIterateContext } from "iterate/react";
import { useKeptContext } from "#/hooks/use-itx-session.ts";
import { itxSessionOf, type ItxConnection, type ItxSession } from "#/lib/itx-session.ts";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const owner = { mind: "example.com", actor: "/members/a" };
const path = "/agents/a";

test("the first load: nothing saved, the live rows, and their tail is in the store afterwards", async () => {
  await database();
  const mind = context([1, 2, 3]);
  const first = await page();
  await using view = await draw(first, { mind });
  await view.until((shown) => shown.caughtUp);
  expect(view.last().events.map((event) => event.offset)).toEqual([1, 2, 3]);
  expect(view.drawn.some((shown) => shown.savedCopy)).toBe(false);
  expect(
    first
      .tails(owner)
      .peek(path)
      ?.tail?.events.map((event) => event.offset),
  ).toEqual([1, 2, 3]);
});

test("a reload draws the saved rows while the mind reads, asks only for what is newer, and keeps them as the same objects", async () => {
  await database();
  const mind = context([1, 2, 3]);
  await saved(mind);
  mind.events.push(stampedEvent(4));
  // the reads of the first page are not this one's
  mind.reads.splice(0);
  mind.hold();
  const second = await page();
  await using view = await draw(second, { mind });
  await view.until((shown) => shown.events.length > 0);
  const copy = view.last();
  expect(copy).toMatchObject({ caughtUp: true, savedCopy: true, head: 3 });
  expect(copy.events.map((event) => event.offset)).toEqual([1, 2, 3]);
  // the probe was asked, and has not answered
  expect(mind).toMatchObject({ reads: [[Number.MAX_SAFE_INTEGER, 1]] });
  mind.release();
  await view.until((shown) => shown.events.length === 4);
  // after the probe, a page that starts below the copy's newest event, which it returns again
  expect(mind).toMatchObject({
    reads: [
      [Number.MAX_SAFE_INTEGER, 1],
      [2, 1_000],
    ],
  });
  const shown = view.last();
  expect(shown.events.map((event) => event.offset)).toEqual([1, 2, 3, 4]);
  expect(shown.events.slice(0, 3).every((event, at) => event === copy.events[at])).toBe(true);
  expect(shown).not.toHaveProperty("savedCopy", true);
});

test("a view mounted again in the same page has its rows in its first render", async () => {
  await database();
  const mind = context([1, 2, 3]);
  const first = await page();
  {
    await using view = await draw(first, { mind });
    await view.until((shown) => shown.caughtUp);
  }
  mind.hold();
  await using again = await draw(first, { mind });
  expect(again.drawn[0]).toMatchObject({ savedCopy: true, caughtUp: true });
  expect(again.drawn[0]?.events.map((event) => event.offset)).toEqual([1, 2, 3]);
});

test("a read the mind refuses while the session is open shows no saved row, and the record goes", async () => {
  await database();
  const mind = context([1, 2, 3]);
  await saved(mind);
  mind.refuse = true;
  const second = await page();
  await using view = await draw(second, { mind });
  await view.until((shown) => Boolean(shown.error));
  expect(view.last()).toMatchObject({ error: "refused", events: [] });
  expect(second.tails(owner).peek(path)).toMatchObject({ tail: undefined });
  await second.tails(owner).flush();
  expect(await (await page()).tails(owner).read(path)).toBe(undefined);
});

test("a read that fails while no session is open drops the saved rows from the view, and keeps the record", async () => {
  await database();
  const mind = context([1, 2, 3]);
  await saved(mind);
  mind.refuse = true;
  const second = await page();
  const session = offline();
  await using view = await draw(second, { mind, session });
  await view.until((shown) => Boolean(shown.error));
  expect(view.last()).toMatchObject({ error: "refused", events: [] });
  await second.tails(owner).flush();
  const read = await (await page()).tails(owner).read(path);
  expect(read?.events.map((event) => event.offset)).toEqual([1, 2, 3]);
});

test("a read that failed with its socket is no refusal once the next session is open: the record stays", async () => {
  await database();
  const mind = context([1, 2, 3]);
  await saved(mind);
  // the socket dies while the reload's read is on its way
  mind.refuse = true;
  const second = await page();
  const session = reopening();
  await using view = await draw(second, { mind, session });
  await view.until((shown) => Boolean(shown.error));
  // the next session opens, and the old stub is still in hand: its successor has not arrived
  await act(() => session.open());
  expect(view.last()).toMatchObject({ error: "refused" });
  await second.tails(owner).flush();
  const read = await (await page()).tails(owner).read(path);
  expect(read?.events.map((event) => event.offset)).toEqual([1, 2, 3]);
});

test("with no store the answers are useKeptContext's", async () => {
  await database();
  const mind = context([1, 2, 3]);
  const first = await page();
  const both: { saved: Shown; kept: Shown }[] = [];
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  function Both() {
    const session = itxSessionOf(mind.handle);
    const saved = first.useSavedContext({
      held: { stub: mind.handle },
      options,
      path,
      session,
      tails: undefined,
    });
    const kept = useKeptContext(useIterateContext(mind.handle, options), path);
    both.push({ saved, kept });
    return null;
  }
  await act(() => root.render(<Both />));
  await until(() => Boolean(both.at(-1)?.saved.caughtUp && both.at(-1)?.kept.caughtUp));
  const last = both.at(-1)!;
  expect(last.saved).toMatchObject({ caughtUp: true, events: last.kept.events });
  expect(both.some(({ saved }) => saved.savedCopy)).toBe(false);
  await act(() => root.unmount());
  host.remove();
});

test("another member's store shows nothing of the first member's saved rows", async () => {
  await database();
  const mind = context([1, 2, 3]);
  await saved(mind);
  mind.hold();
  const second = await page();
  await using view = await draw(second, { mind, actor: "/members/b" });
  // the store has answered: the read has asked the probe
  await until(() => mind.reads.length > 0);
  expect(view.drawn.every((shown) => shown.events.length === 0)).toBe(true);
  mind.release();
  await view.until((shown) => shown.caughtUp);
  expect(view.drawn.some((shown) => shown.savedCopy)).toBe(false);
});

type Page = Awaited<ReturnType<typeof page>>;
type Shown = ReturnType<Page["useSavedContext"]>;

test("a saved tail of a log made again under the same path: its rows go, and the page below the read is read at once", async () => {
  await database();
  await saved(context([1, 2, 3]));
  // the same path, another log: other events at the same offsets, and one more
  const again = context([1, 2, 3, 4]);
  for (const event of again.events) event.createdAt = `2027-01-01T00:00:0${event.offset}.000Z`;
  again.hold();
  const second = await page();
  await using view = await draw(second, { mind: again });
  await view.until((shown) => shown.events.length > 0);
  expect(view.last()).toMatchObject({ savedCopy: true });
  again.release();
  // the read began at the copy's newest offset, 3, and held 3 and 4 alone: the rest follows
  await view.until((shown) => !shown.savedCopy && shown.events.length === 4);
  expect(view.last()).toMatchObject({ events: again.events });
  expect(again).toMatchObject({
    reads: [
      [Number.MAX_SAFE_INTEGER, 1],
      [2, 1_000],
      // the page below, which a read with no copy would have held
      [0, 2],
    ],
  });
});

const options = { consumes: ["*"], liveState: [] };

/** The stores that tests loaded and that were not ended yet. */
const stores: { wipeSavedLogTails(): Promise<void> }[] = [];

/** A new database for the test, as the browser's `indexedDB`. An earlier test's page may still
 *  have a write on its way (a view that unmounts writes what waits): each one is ended first, so
 *  that nothing of it lands in this test's database. */
async function database() {
  for (const earlier of stores.splice(0)) await earlier.wipeSavedLogTails();
  vi.stubGlobal("indexedDB", new IDBFactory());
}

/** The hook and the store as a new page loads them: no memory, the same database. */
async function page() {
  vi.resetModules();
  const { useSavedContext } = await import("./saved-context.ts");
  const store = await import("#/lib/saved-log-tail.ts");
  stores.push(store);
  return { useSavedContext, tails: store.savedLogTails };
}

/** A first page that reads `mind` and saves its tail. */
async function saved(mind: ReturnType<typeof context>) {
  const first = await page();
  {
    await using view = await draw(first, { mind });
    await view.until((shown) => shown.caughtUp);
  }
  await first.tails(owner).flush();
}

/** Draw a view of `path` on `page`, and keep what each render answered. */
async function draw(
  page: Page,
  {
    mind,
    actor = owner.actor,
    session,
  }: { mind: ReturnType<typeof context>; actor?: string; session?: ItxSession },
) {
  const drawn: Shown[] = [];
  const tails = page.tails({ ...owner, actor });
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  function View() {
    drawn.push(
      page.useSavedContext({
        held: { stub: mind.handle },
        options,
        path,
        session: session || itxSessionOf(mind.handle),
        tails,
      }),
    );
    return null;
  }
  await act(() => root.render(<View />));
  return {
    drawn,
    last: () => drawn.at(-1)!,
    until: (done: (shown: Shown) => boolean) => until(() => done(drawn.at(-1)!)),
    [Symbol.asyncDispose]: async () => {
      await act(() => root.unmount());
      host.remove();
    },
  };
}

async function until(done: () => boolean) {
  for (let round = 0; round < 100 && !done(); round += 1)
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
  expect(done()).toBe(true);
}

/** A session whose socket is gone: the page reconnects. */
function offline(): ItxSession {
  const connection: ItxConnection = { epoch: 1, state: "reconnecting" };
  return { get: () => connection, subscribe: () => () => {}, watch: () => () => {} };
}

/** A session whose socket is gone, and whose next one opens when `open()` is called. */
function reopening(): ItxSession & { open(): void } {
  let connection: ItxConnection = { epoch: 1, state: "reconnecting" };
  const watchers = new Set<() => void>();
  const watch = (changed: () => void) => {
    watchers.add(changed);
    return () => void watchers.delete(changed);
  };
  return {
    get: () => connection,
    subscribe: watch,
    watch,
    open() {
      connection = { epoch: 2, state: "open" };
      for (const changed of watchers) changed();
    },
  };
}

/** A context whose log holds events at `offsets`. `hold()` keeps every read unanswered until
 *  `release()`; `refuse` refuses every read; `reads` are the reads asked, as (after, limit). */
function context(offsets: number[]) {
  const reads: [number, number][] = [];
  let gate = Promise.resolve();
  let open = () => {};
  const mind = {
    events: offsets.map((offset) => stampedEvent(offset)),
    reads,
    refuse: false,
    hold() {
      gate = new Promise((resolve) => (open = resolve));
    },
    release: () => open(),
    handle: {
      readEvents: async (after: number, limit: number) => {
        reads.push([after, limit]);
        await gate;
        if (mind.refuse) throw new Error("refused");
        const newer = mind.events.filter((event) => event.offset > after).slice(0, limit);
        return {
          events: newer,
          atHead: true,
          scannedThroughOffset: newer.at(-1)?.offset || mind.events.at(-1)?.offset || 0,
        };
      },
      subscribe: async () => ({ [Symbol.dispose]() {} }),
      subscriptions: { list: async () => [] },
      rpcStubs: { list: async () => [] },
      invoke: async () => ({ rev: 1, state: {} }),
      [Symbol.dispose]() {},
    } as unknown as Parameters<typeof useIterateContext>[0] & object,
  };
  return mind;
}

function stampedEvent(offset: number) {
  return {
    offset,
    type: "events.iterate.com/agent/context-added",
    createdAt: `2026-11-16T00:00:0${offset}.000Z`,
    path,
    payload: { role: "user", content: `message ${offset}` },
  };
}
