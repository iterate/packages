// @vitest-environment jsdom
// The context explorer's log over a reload: with a member's saved tails (`tails`) it draws the
// rows it showed last at once, with no loading words, and asks the mind only for what is newer.
// The store is fake-indexeddb, a new database for each test; a reload is a fresh import of the
// explorer and the store, whose memory is then gone. Every text the explorer showed is recorded,
// and the store's copy is the log's own events, so it shows which objects the view holds. The
// hook's own rules are in #/lib/saved-context.test.tsx.
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import type { ItxConnection, ItxSession } from "#/lib/itx-session.ts";

Object.assign(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: true,
  // jsdom lays nothing out: the virtual log's scroller asks for one
  ResizeObserver: class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
});

const owner = { mind: "example.com", actor: "/members/a" };
const path = "/agents/a";
/** What a view says while it reads the log. */
const loadingWords = /loading|reading/i;

test("a second draw on the same context shows the saved rows while the mind reads, with no loading words, then the newer event after them", async () => {
  await database();
  const mind = context([1, 2, 3]);
  await saved(mind);
  mind.events.push(stampedEvent(4));
  mind.hold();
  const second = await page();
  const tails = second.tails(owner);
  await using view = await draw(second, { mind, tails });
  await until(() => view.text().includes("3 events") && mind.reads.length > 0);
  // what the store read: the rows drawn now
  const copy = tails.peek(path)?.tail?.events || [];
  expect(copy.map((event) => event.offset)).toEqual([1, 2, 3]);
  // nothing was ever said of a read: the path alone, then the saved rows
  expect(view.texts.filter((text) => loadingWords.test(text))).toEqual([]);
  // the probe was asked, and has not answered
  expect(mind).toMatchObject({ reads: [[Number.MAX_SAFE_INTEGER, 1]] });
  await act(() => mind.release());
  await until(() => view.text().includes("4 events"));
  // after the probe, a page that starts below the copy's newest event, which it returns again
  expect(mind).toMatchObject({
    reads: [
      [Number.MAX_SAFE_INTEGER, 1],
      [2, 1_000],
    ],
  });
  // the log the view holds: the saved rows as the same objects, and the new event last
  await until(() => tails.peek(path)?.tail?.events.length === 4);
  const shown = tails.peek(path)?.tail?.events || [];
  expect(shown.map((event) => event.offset)).toEqual([1, 2, 3, 4]);
  expect(shown.slice(0, 3).every((event, at) => event === copy[at])).toBe(true);
  expect(view.texts.filter((text) => loadingWords.test(text))).toEqual([]);
});

test("with no tails the explorer reads as before: loading words, then the whole newest page", async () => {
  await database();
  const mind = context([1, 2, 3]);
  mind.hold();
  const first = await page();
  await using view = await draw(first, { mind, tails: undefined });
  await until(() => mind.reads.length > 0);
  expect(view.text()).toContain("Loading the log");
  await act(() => mind.release());
  await until(() => view.text().includes("3 events"));
  expect(mind).toMatchObject({
    reads: [
      [Number.MAX_SAFE_INTEGER, 1],
      [0, 1_000],
    ],
  });
  expect(view.text()).not.toMatch(loadingWords);
});

test("another member's store shows nothing of the first member's saved rows", async () => {
  await database();
  const mind = context([1, 2, 3]);
  await saved(mind);
  mind.hold();
  const second = await page();
  await using view = await draw(second, {
    mind,
    tails: second.tails({ ...owner, actor: "/members/b" }),
  });
  // the store has answered: the read has asked the probe
  await until(() => mind.reads.length > 0);
  expect(view.text()).toContain("Loading the log");
  expect(view.texts.some((text) => text.includes("3 events"))).toBe(false);
  await act(() => mind.release());
  await until(() => view.text().includes("3 events"));
  // the whole newest page: no copy's offset was the read's start
  expect(mind).toMatchObject({
    reads: [
      [Number.MAX_SAFE_INTEGER, 1],
      [0, 1_000],
    ],
  });
});

test("a context the mind refuses while the session is open: no saved row stays, and the record goes", async () => {
  await database();
  const mind = context([1, 2, 3]);
  await saved(mind);
  mind.refuse = true;
  const second = await page();
  const tails = second.tails(owner);
  await using view = await draw(second, { mind, tails });
  await until(() => Boolean(view.host.querySelector('[role="alert"]')));
  expect(view.host.querySelector('[role="alert"]')?.textContent).toBe("no context /agents/a");
  // the error stands in the place of the view: no row of the copy is drawn
  expect(view.host.textContent).not.toContain("3 events");
  await until(() => tails.peek(path)?.tail === undefined);
  await tails.flush();
  expect(await (await page()).tails(owner).read(path)).toBe(undefined);
});

test("a context that fails to open while no session is open keeps its record", async () => {
  await database();
  const mind = context([1, 2, 3]);
  await saved(mind);
  mind.refuse = true;
  const second = await page();
  const tails = second.tails(owner);
  {
    await using view = await draw(second, { mind, tails, session: offline() });
    await until(() => mind.opened > 0);
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(view.host.querySelector('[role="alert"]')).toBe(null);
  }
  await tails.flush();
  const read = await (await page()).tails(owner).read(path);
  expect(read?.events.map((event) => event.offset)).toEqual([1, 2, 3]);
});

test("going from one context to another and back, each saved tail holds its own events, and none is shown under the other's path", async () => {
  await database();
  const first = await page();
  const tails = first.tails(owner);
  // two contexts with other events at the same offsets: for a render after the path changes, the
  // stub in hand is still the last context's
  const stamped = (of: string, day: number) => (offset: number) => ({
    offset,
    type: "events.iterate.com/agent/context-added",
    createdAt: `2026-11-${String(day)}T00:00:0${String(offset)}.000Z`,
    path: of,
    payload: { role: "user", content: `${of} ${String(offset)}` },
  });
  const logs: Record<string, ReturnType<ReturnType<typeof stamped>>[]> = {
    "/agents/a": [1, 2, 3].map(stamped("/agents/a", 16)),
    "/agents/b": [1, 2, 3, 4].map(stamped("/agents/b", 17)),
  };
  const subscription = async () => ({ [Symbol.dispose]() {} });
  const root = {
    cd: async (to: string) => ({
      readEvents: async (after: number, limit: number) => {
        const newer = (logs[to] || []).filter((event) => event.offset > after).slice(0, limit);
        return {
          events: newer,
          atHead: true,
          scannedThroughOffset: newer.at(-1)?.offset || logs[to]?.at(-1)?.offset || 0,
        };
      },
      subscribe: subscription,
      subscriptions: { list: async () => [] },
      rpcStubs: { list: async () => [] },
      invoke: async () => ({ rev: 1, state: {} }),
      append: async () => {},
      [Symbol.dispose]() {},
    }),
    invoke: async () => ({ rev: 1, state: {} }),
    subscribe: subscription,
    [Symbol.dispose]() {},
  } as unknown as Awaited<ReturnType<Parameters<Page["ContextExplorer"]>[0]["openRoot"] & {}>>;
  const host = document.body.appendChild(document.createElement("div"));
  const view = createRoot(host);
  const texts: string[] = [];
  const watcher = new MutationObserver(() => texts.push(host.textContent || ""));
  watcher.observe(host, { childList: true, subtree: true, characterData: true });
  const deps = [root];
  const show = (shown: string) =>
    act(() =>
      view.render(
        <first.ContextExplorer
          openRoot={async () => root}
          deps={deps}
          path={shown}
          links={{ hrefOf: (to) => `?context=${to}`, onNavigate: () => {} }}
          state={{}}
          onStateChange={() => {}}
          tails={tails}
        />,
      ),
    );
  const contentOf = (of: string) =>
    (tails.peek(of)?.tail?.events || []).map((event) => Object(Object(event).payload).content);
  await show("/agents/b");
  await until(() => (host.textContent || "").includes("4 events"));
  await show("/agents/a");
  await until(() => (host.textContent || "").includes("3 events"));
  // back to b, whose tail the page holds: its rows are drawn from it at once
  const before = texts.length;
  await show("/agents/b");
  await until(() => (host.textContent || "").includes("4 events"));
  // b never showed a's three events
  expect(texts.slice(before).filter((text) => text.includes("3 events"))).toEqual([]);
  expect(contentOf("/agents/b")).toEqual([1, 2, 3, 4].map((offset) => `/agents/b ${offset}`));
  expect(contentOf("/agents/a")).toEqual([1, 2, 3].map((offset) => `/agents/a ${offset}`));
  watcher.disconnect();
  await act(() => view.unmount());
  host.remove();
  // and what a new page reads back of each
  await tails.flush();
  const again = (await page()).tails(owner);
  expect(await again.read("/agents/b")).toMatchObject({
    events: [1, 2, 3, 4].map((offset) => ({ payload: { content: `/agents/b ${offset}` } })),
  });
  expect(await again.read("/agents/a")).toMatchObject({
    events: [1, 2, 3].map((offset) => ({ payload: { content: `/agents/a ${offset}` } })),
  });
});

/** The stores that tests loaded and that were not ended yet. */
const stores: { wipeSavedLogTails(): Promise<void> }[] = [];

/** A new database for the test, as the browser's `indexedDB`, and no view drawn yet. An earlier
 *  test's page may still have a write on its way: each one is ended first. */
async function database() {
  for (const earlier of stores.splice(0)) await earlier.wipeSavedLogTails();
  vi.stubGlobal("indexedDB", new IDBFactory());
}

/** The explorer and the store as a new page loads them: no memory, the same database. */
async function page() {
  vi.resetModules();
  const { ContextExplorer } = await import("./context-explorer.tsx");
  const store = await import("#/lib/saved-log-tail.ts");
  stores.push(store);
  return { ContextExplorer, tails: store.savedLogTails };
}

type Page = Awaited<ReturnType<typeof page>>;

/** A first page that shows `mind`'s context and saves its tail; its reads are forgotten. */
async function saved(mind: ReturnType<typeof context>) {
  const first = await page();
  const tails = first.tails(owner);
  {
    await using view = await draw(first, { mind, tails });
    await until(() => view.text().includes("3 events"));
  }
  await tails.flush();
  mind.reads.splice(0);
}

/** The explorer on `page`, showing `path`. */
async function draw(
  page: Page,
  {
    mind,
    tails,
    session,
  }: {
    mind: ReturnType<typeof context>;
    tails: ReturnType<Page["tails"]> | undefined;
    session?: ItxSession;
  },
) {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  // every text shown, in order
  const texts: string[] = [];
  const watcher = new MutationObserver(() => texts.push(host.textContent || ""));
  watcher.observe(host, { childList: true, subtree: true, characterData: true });
  await act(() =>
    root.render(
      <page.ContextExplorer
        openRoot={async () => mind.root}
        deps={[mind]}
        session={session}
        path={path}
        links={{ hrefOf: (to) => `?context=${to}`, onNavigate: () => {} }}
        state={{}}
        onStateChange={() => {}}
        tails={tails}
      />,
    ),
  );
  return {
    host,
    texts,
    text: () => host.textContent || "",
    [Symbol.asyncDispose]: async () => {
      watcher.disconnect();
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

/** A mind's root whose context `path` holds events at `offsets`. `hold()` keeps every read
 *  unanswered until `release()`; `refuse` refuses to open the context; `reads` are the reads
 *  asked, as (after, limit); `opened` counts the opens asked. */
function context(offsets: number[]) {
  const reads: [number, number][] = [];
  let gate = Promise.resolve();
  let open = () => {};
  const subscription = async () => ({ [Symbol.dispose]() {} });
  const handle = {
    readEvents: async (after: number, limit: number) => {
      reads.push([after, limit]);
      await gate;
      const newer = mind.events.filter((event) => event.offset > after).slice(0, limit);
      return {
        events: newer,
        atHead: true,
        scannedThroughOffset: newer.at(-1)?.offset || mind.events.at(-1)?.offset || 0,
      };
    },
    subscribe: subscription,
    subscriptions: { list: async () => [] },
    rpcStubs: { list: async () => [] },
    invoke: async () => ({ rev: 1, state: {} }),
    append: async () => {},
    [Symbol.dispose]() {},
  };
  const mind = {
    events: offsets.map((offset) => stampedEvent(offset)),
    reads,
    refuse: false,
    opened: 0,
    hold() {
      gate = new Promise((resolve) => (open = resolve));
    },
    release: () => open(),
    root: {
      cd: async (to: string) => {
        mind.opened += 1;
        if (mind.refuse || to !== path) throw new Error(`no context ${to}`);
        return handle;
      },
      // the `mind` facet's live state: no registry paths
      invoke: async () => ({ rev: 1, state: {} }),
      subscribe: subscription,
      [Symbol.dispose]() {},
    } as unknown as Awaited<ReturnType<Parameters<Page["ContextExplorer"]>[0]["openRoot"] & {}>>,
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
