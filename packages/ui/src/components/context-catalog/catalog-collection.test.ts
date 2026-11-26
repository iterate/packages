// The catalog as TanStack DB collections (catalog-collection.ts), against a catalog made here that
// answers as iterate/api says a watch does: a `reset` or a `resume`, then `change` frames, one
// batch for one write.
import {
  and,
  BasicIndex,
  createCollection,
  createLiveQueryCollection,
  eq,
  inArray,
  localOnlyCollectionOptions,
} from "@tanstack/db";
import { expect, test } from "vitest";
import {
  CatalogAwakeRow,
  catalogQueryOf,
  CatalogRow,
  catalogWatcher,
  compareTextBinary,
  contextsCollectionOptions,
  watchedQueryCollectionOptions,
  type CatalogItx,
} from "./catalog-collection.ts";
import { ITX_SESSION, type ItxConnection } from "#/lib/itx-session.ts";
import { fakeCatalog } from "#/test-support/fake-catalog.ts";

test("orders as UTF-8 bytes, where JavaScript's own order differs", () => {
  const astral = "\u{1F600}";
  const privateUse = "\u{E000}";
  expect(astral < privateUse).toBe(true);
  expect(compareTextBinary(astral, privateUse)).toBe(1);
  expect(compareTextBinary("/a", "/a/b")).toBe(-1);
  expect(compareTextBinary("/a", "/a")).toBe(0);
});

test("facts, the tree and each order become one window", async () => {
  const catalog = fakeCatalog();
  const { contexts } = page(catalog);
  const open = createLiveQueryCollection((q) =>
    q
      .from({ c: contexts })
      .where(({ c }) =>
        and(
          eq(c.metadata?.status, "open"),
          inArray("pinned", c.metadata?.tags),
          inArray("agent", c.processors),
          inArray("/agents", c.under),
        ),
      )
      .orderBy(({ c }) => c.createdMs, "desc")
      .limit(20),
  );
  await open.preload();
  expect(catalog.calls[0]?.query).toEqual({
    where: { $processor: "agent", status: "open", tags: "pinned" },
    under: "/agents",
    order: "created",
    limit: 20,
  });

  const children = createLiveQueryCollection((q) =>
    q
      .from({ c: contexts })
      .where(({ c }) => eq(c.parent, "/agents"))
      .orderBy(({ c }) => c.path, "asc")
      .limit(5),
  );
  await children.preload();
  expect(catalog.calls[1]?.query).toEqual({ childrenOf: "/agents", order: "path", limit: 5 });
});

test("a limit over a condition that the catalog has no index for is refused with the reason", () => {
  const refused = createLiveQueryCollection((q) =>
    q
      .from({
        c: createCollection(contextsCollectionOptions({ watcher: page(fakeCatalog()).watcher })),
      })
      .where(({ c }) => eq(c.description, "x"))
      .orderBy(({ c }) => c.activeMs, "desc")
      .limit(5),
  );
  return expect(refused.preload()).rejects.toThrow(/no index for a condition/);
});

test("an order that the catalog does not keep is refused", () => {
  expect(() =>
    catalogQueryOf({
      limit: 5,
      orderBy: [
        {
          expression: { type: "ref", path: ["activeMs"] } as never,
          compareOptions: { direction: "asc", nulls: "last" },
        },
      ],
    }),
  ).toThrow(/three orders/);
});

test("a window holds the newest rows, and a write moves it", async () => {
  const catalog = fakeCatalog();
  catalog.put("/a", 10);
  catalog.put("/b", 20);
  catalog.put("/c", 30);
  const { contexts } = page(catalog);
  const recent = createLiveQueryCollection((q) =>
    q
      .from({ c: contexts })
      .orderBy(({ c }) => c.activeMs, "desc")
      .limit(2),
  );
  await recent.preload();
  expect(recent.toArray.map((row) => row.path)).toEqual(["/c", "/b"]);
  expect(catalog.calls.map((call) => call.query)).toEqual([{ order: "active", limit: 2 }]);

  catalog.put("/a", 40);
  await tick();
  expect(recent.toArray.map((row) => row.path)).toEqual(["/a", "/c"]);
  // the row that left the window left the collection: nothing would keep it true
  expect(contexts.has("/b")).toBe(false);
  expect(contexts.get("/a")).toMatchObject({ parent: "/", under: ["/", "/a"] });

  catalog.remove("/a");
  await tick();
  expect(recent.toArray.map((row) => row.path)).toEqual(["/c", "/b"]);
  // one watch for the life of the query
  expect(catalog.calls).toHaveLength(1);
});

test("every join asks by key, and all keys are one catalog query", async () => {
  const catalog = fakeCatalog();
  catalog.put("/tasks/1", 10, { description: "the first" });
  catalog.put("/tasks/2", 20, { description: "the second" });
  catalog.put("/other", 30);
  const { contexts } = page(catalog);
  const tasks = createCollection(
    localOnlyCollectionOptions<{ id: string; context: string }>({
      getKey: (task) => task.id,
      initialData: [{ id: "t1", context: "/tasks/1" }],
    }),
  );
  const joined = createLiveQueryCollection((q) =>
    q
      .from({ t: tasks })
      .join({ c: contexts }, ({ t, c }) => eq(t.context, c.path), "left")
      .select(({ t, c }) => ({ id: t.id, description: c?.description })),
  );
  await joined.preload();
  expect(joined.toArray).toMatchObject([{ id: "t1", description: "the first" }]);

  tasks.insert({ id: "t2", context: "/tasks/2" });
  await tick();
  await tick();
  expect(joined.toArray.map((row) => row.description).toSorted()).toEqual([
    "the first",
    "the second",
  ]);
  const keyCalls = catalog.calls.filter((call) => call.query.keys);
  expect(keyCalls.map((call) => call.query.keys)).toEqual([["/tasks/1"], ["/tasks/1", "/tasks/2"]]);
  // one watch of keys at a time: the older one ended
  expect([...catalog.watching].filter((watch) => watch.query.keys)).toHaveLength(1);
  expect(contexts.has("/other")).toBe(false);

  catalog.put("/tasks/2", 50, { description: "changed" });
  await tick();
  expect(joined.toArray.map((row) => row.description).toSorted()).toEqual(["changed", "the first"]);
});

test("one write over two watches lands in one turn: a page that draws after it never draws half", async () => {
  const catalog = fakeCatalog();
  catalog.put("/a", 10);
  const { watcher, contexts } = page(catalog);
  const awake = createCollection(
    watchedQueryCollectionOptions({
      watcher,
      query: { awake: true },
      row: CatalogAwakeRow,
    }),
  );
  const recent = createLiveQueryCollection((q) =>
    q
      .from({ c: contexts })
      .orderBy(({ c }) => c.activeMs, "desc")
      .limit(10),
  );
  const rows = createLiveQueryCollection((q) =>
    q
      .from({ c: recent })
      .join({ a: awake }, ({ c, a }) => eq(c.path, a.path), "left")
      .select(({ c, a }) => ({ path: c.path, activeMs: c.activeMs, since: a?.since })),
  );
  await rows.preload();
  expect(rows.toArray).toMatchObject([{ path: "/a", activeMs: 10 }]);
  const seen: string[] = [];
  // as React draws: after the turn in which the store changed
  rows.subscribeChanges(() => {
    queueMicrotask(() => {
      seen.push(rows.toArray.map((row) => `${String(row.activeMs)} ${String(row.since)}`).join());
    });
  });

  let batches = 0;
  watcher.onBatch(() => (batches += 1));
  catalog.putAwake("/a", 99);
  await tick();
  expect(batches).toBe(1);
  expect(rows.toArray).toMatchObject([{ path: "/a", activeMs: 99, since: 99 }]);
  expect(new Set(seen)).toEqual(new Set(["99 99"]));
});

test("a new session starts each watch again with its cursor, and gets only what it lacks", async () => {
  const catalog = fakeCatalog();
  catalog.put("/a", 10);
  catalog.put("/b", 20);
  catalog.put("/c", 30);
  const watcher = catalogWatcher(catalog.itx);
  const changes: { del: string[]; put: string[] }[] = [];
  const watch = watcher.watch({ order: "active", limit: 10 }, CatalogRow, ({ del, put }) =>
    changes.push({ del, put: put.map((row) => row.path) }),
  );
  await watch.ready;
  expect([...watch.rows.keys()]).toEqual(["/c", "/b", "/a"]);

  // while the page is away: one row goes, one comes
  catalog.newSession();
  catalog.remove("/b");
  catalog.put("/d", 40);
  await tick();
  expect(catalog.calls[1]?.cursor).toMatchObject({ gen: "g1", rev: 3, bound: [10, "/a"] });
  expect(changes.at(-1)).toEqual({ del: ["/b"], put: ["/d"] });
  expect([...watch.rows.keys()].toSorted()).toEqual(["/a", "/c", "/d"]);

  // a catalog of another generation answers every row
  catalog.newSession({ newGeneration: true });
  await tick();
  expect(changes.at(-1)?.put.toSorted()).toEqual(["/a", "/c", "/d"]);
  expect(watch).toMatchObject({ answers: 3 });
});

test("a change that comes with a gap starts the watch again", async () => {
  const catalog = fakeCatalog();
  catalog.put("/a", 10);
  const watcher = catalogWatcher(catalog.itx);
  const watch = watcher.watch({ order: "active", limit: 10 }, CatalogRow, () => {});
  await watch.ready;
  const [live] = catalog.watching;
  // a frame whose `from` is not this watch's revision
  live?.onFrame({ type: "change", gen: "g1", from: 7, rev: 8, del: ["/a"], rows: [] });
  await tick();
  expect(catalog.calls).toHaveLength(2);
  expect(watch.rows.has("/a")).toBe(true);
  expect(watch.error).toBeUndefined();
});

test("a platform without contexts.watch says so once, and the watch ends with the reason", async () => {
  const itx: CatalogItx = {
    contexts: { watch: () => Promise.reject(new TypeError("watch is not a function")) },
  };
  const watcher = catalogWatcher(itx);
  const said: string[] = [];
  watcher.subscribe(() => said.push(watcher.support()));
  const watch = watcher.watch({ awake: true }, CatalogAwakeRow, () => {});
  await expect(watch.ready).rejects.toThrow("watch is not a function");
  expect(said).toEqual(["none"]);
});

test("two key loads that overlap both settle: the first waits for the watch that replaced its own", async () => {
  const catalog = fakeCatalog();
  catalog.put("/a", 10);
  catalog.put("/b", 20);
  const { contexts } = page(catalog);
  const one = createLiveQueryCollection((q) =>
    q.from({ c: contexts }).where(({ c }) => eq(c.path, "/a")),
  );
  const first = one.preload();
  // the first keys watch is sent, and its answer is not here yet
  await Promise.resolve();
  await Promise.resolve();
  const two = createLiveQueryCollection((q) =>
    q.from({ c: contexts }).where(({ c }) => eq(c.path, "/b")),
  );
  await Promise.all([first, two.preload()]);
  expect(one.toArray.map((row) => row.path)).toEqual(["/a"]);
  expect(two.toArray.map((row) => row.path)).toEqual(["/b"]);
  expect(catalog.calls.map((call) => call.query.keys)).toEqual([["/a"], ["/a", "/b"]]);
});

test("a row that has its old revision after the catalog made its tables again is written again", async () => {
  const catalog = fakeCatalog();
  catalog.put("/a", 10, { description: "before" });
  const { contexts } = page(catalog);
  const recent = createLiveQueryCollection((q) =>
    q
      .from({ c: contexts })
      .orderBy(({ c }) => c.activeMs, "desc")
      .limit(5),
  );
  await recent.preload();
  expect(contexts.get("/a")).toMatchObject({ description: "before", rev: 1 });
  catalog.madeAgain((rows) => {
    const row = rows.get("/a");
    if (row) rows.set("/a", { ...row, description: "after" });
  });
  catalog.newSession();
  await tick();
  expect(contexts.get("/a")).toMatchObject({ description: "after", rev: 1 });
});

test("a query with no limit says so when more rows match than the catalog holds, and stops saying it", async () => {
  const catalog = fakeCatalog();
  for (let n = 0; n < 499; n++) catalog.put(`/t/${String(n)}`, n, { metadata: { kind: "t" } });
  const { contexts } = page(catalog);
  const all = createLiveQueryCollection((q) =>
    q.from({ c: contexts }).where(({ c }) => eq(c.metadata?.kind, "t")),
  );
  await all.preload();
  expect(contexts.utils.demands()).toMatchObject([{ rows: 499, full: false }]);
  catalog.put("/t/more", 1_000, { metadata: { kind: "t" } });
  await tick();
  expect(contexts.utils.demands()).toMatchObject([{ rows: 500, full: true }]);
  catalog.remove("/t/more");
  await tick();
  expect(contexts.utils.demands()).toMatchObject([{ rows: 499, full: false }]);
});

test("more keys than the catalog watches are refused with the reason, and the keys watch before stays", async () => {
  const catalog = fakeCatalog();
  catalog.put("/a", 10, { description: "one" });
  const { contexts } = page(catalog);
  const one = createLiveQueryCollection((q) =>
    q.from({ c: contexts }).where(({ c }) => eq(c.path, "/a")),
  );
  await one.preload();
  const many = createLiveQueryCollection((q) =>
    q.from({ c: contexts }).where(({ c }) =>
      inArray(
        c.path,
        Array.from({ length: 500 }, (_, n) => `/k/${String(n)}`),
      ),
    ),
  );
  await expect(many.preload()).rejects.toThrow(/501 contexts by path/);
  catalog.put("/a", 20, { description: "two" });
  await tick();
  expect(one.toArray).toMatchObject([{ description: "two" }]);
});

test("a refusal that is not the query's makes the catalog no source, a limit of watches does not, and a later probe makes it live", async () => {
  const catalog = fakeCatalog();
  const watcher = catalogWatcher(catalog.itx);
  catalog.refuseNext("UNAVAILABLE");
  watcher.probe();
  await tick();
  expect(watcher.support()).toBe("none");
  watcher.probe();
  await tick();
  expect(watcher.support()).toBe("live");
  // the session is at its limit: this watch is refused, and the catalog is a source as before
  catalog.refuseNext("WATCH_LIMIT");
  const refused = watcher.watch({ awake: true }, CatalogAwakeRow, () => {});
  await expect(refused.ready).rejects.toThrow();
  expect(watcher.support()).toBe("live");
  // the catalog itself failed: an error with no code
  catalog.refuseNext("");
  const failed = watcher.watch({ awake: true }, CatalogAwakeRow, () => {});
  await expect(failed.ready).rejects.toThrow();
  expect(watcher.support()).toBe("none");
});

test("a batch whose last frame never comes is ended by the page itself", async () => {
  const catalog = fakeCatalog();
  catalog.put("/a", 10);
  const watcher = catalogWatcher(catalog.itx);
  const watch = watcher.watch({ order: "active", limit: 10 }, CatalogRow, () => {});
  await watch.ready;
  let ends = 0;
  watcher.onBatch(() => (ends += 1));
  const [live] = catalog.watching;
  live?.onFrame({ type: "change", gen: "g1", from: 1, rev: 2, del: ["/a"], rows: [], more: true });
  expect(watcher.batchOpen()).toBe(true);
  expect(ends).toBe(0);
  await new Promise((resolve) => setTimeout(resolve, 80));
  expect(watcher.batchOpen()).toBe(false);
  expect(ends).toBe(1);
});

test("a watch asked before the page's first socket is open is asked once, and a platform without the watch is heard", async () => {
  // a page's session as memberItx says it: no socket yet, then the socket, then the proof
  let connection: ItxConnection = { epoch: 0, state: "opening" };
  const listeners = new Set<() => void>();
  const say = (next: ItxConnection) => {
    connection = next;
    for (const changed of listeners) changed();
  };
  const answer = Promise.withResolvers<Disposable>();
  let calls = 0;
  const itx: CatalogItx & { [ITX_SESSION]: unknown } = {
    [ITX_SESSION]: {
      get: () => connection,
      subscribe(changed: () => void) {
        listeners.add(changed);
        return () => listeners.delete(changed);
      },
      watch: () => () => {},
    },
    contexts: {
      watch() {
        calls += 1;
        return answer.promise;
      },
    },
  };
  const watcher = catalogWatcher(itx);
  const watch = watcher.watch({ awake: true }, CatalogAwakeRow, () => {});
  say({ epoch: 1, state: "opening" });
  say({ epoch: 1, state: "open" });
  answer.reject(new Error("No such method: contexts.watch"));
  await expect(watch.ready).rejects.toThrow("No such method");
  expect(calls).toBe(1);
  expect(watcher.support()).toBe("none");
});

test("a watch that the catalog ends is watched again, and a catalog that ends it three times is given up", async () => {
  const ends: (() => void)[] = [];
  let calls = 0;
  const itx: CatalogItx = {
    contexts: {
      watch(_query, onFrame) {
        calls += 1;
        onFrame({ type: "reset", gen: "g1", rev: 1, q: "awake", full: false, rows: [] });
        const ended = Promise.withResolvers<void>();
        ends.push(ended.resolve);
        return Promise.resolve({ [Symbol.dispose]: () => {}, ended: () => ended.promise });
      },
    },
  };
  const watcher = catalogWatcher(itx);
  const watch = watcher.watch({ awake: true }, CatalogAwakeRow, () => {});
  await watch.ready;
  for (const _ of [1, 2, 3]) {
    ends.at(-1)?.();
    await tick();
  }
  expect(calls).toBe(3);
  expect(watch).toMatchObject({
    error: "the catalog ended the watch three times in half a minute",
  });
  expect(watcher.support()).toBe("none");
});

test("a query that the catalog refuses ends its watch alone", async () => {
  const catalog = fakeCatalog();
  const watcher = catalogWatcher(catalog.itx);
  const awake = watcher.watch({ awake: true }, CatalogAwakeRow, () => {});
  await awake.ready;
  const refused = watcher.watch({ where: { refused: true } }, CatalogRow, () => {});
  await expect(refused.ready).rejects.toThrow("the catalog refuses this");
  expect(watcher.support()).toBe("live");
  expect(awake.error).toBeUndefined();
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function page(catalog: ReturnType<typeof fakeCatalog>) {
  const watcher = catalogWatcher(catalog.itx);
  // with indexes, as the Dash makes it (context-catalog-live.ts)
  const contexts = createCollection(
    contextsCollectionOptions({
      watcher,
      index: { defaultIndexType: BasicIndex, autoIndex: "eager" },
    }),
  );
  return { watcher, contexts };
}
