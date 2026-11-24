// The saved tails of contexts' logs, in IndexedDB (fake-indexeddb, a new database for each test):
// what a new page reads back, the bounds, the owners, and that nothing fails without a database.
// A reload is a fresh import of the module: its memory is gone, the database stays.
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { expect, test, vi } from "vitest";

const owner = { mind: "example.com", actor: "/members/a" };

test("a new page reads back the newest 1,000 durable events that the last page saved, oldest first", async () => {
  await database();
  const first = (await page()).savedLogTails(owner);
  first.save(
    "/agents/a",
    [...offsets(1, 1_100).map((at) => event(at)), event(1_101, { ephemeral: true })],
    true,
    1,
  );
  await first.flush();
  const second = (await page()).savedLogTails(owner);
  // the memory is gone: only the database can say
  expect(second.peek("/agents/a")).toBe(undefined);
  const read = await second.read("/agents/a");
  expect(read).toMatchObject({ exhausted: false });
  expect(read?.events.map((one) => one.offset)).toEqual(offsets(101, 1_100));
  expect(second.peek("/agents/a")?.tail?.events).toHaveLength(1_000);
});

test("the character bound drops the oldest events, and an event over it alone saves nothing and deletes the record", async () => {
  await database();
  const first = (await page()).savedLogTails(owner);
  // four events of 600,000 characters: three fit in 2,000,000
  first.save(
    "/agents/a",
    offsets(1, 4).map((at) => event(at, { characters: 600_000 })),
    true,
    1,
  );
  expect(first.peek("/agents/a")).toMatchObject({ tail: { exhausted: false } });
  expect(first.peek("/agents/a")?.tail?.events.map((one) => one.offset)).toEqual([2, 3, 4]);
  await first.flush();
  expect((await (await page()).savedLogTails(owner).read("/agents/a"))?.events).toHaveLength(3);
  first.save("/agents/a", [event(1), event(2, { characters: 2_100_000 })], true, 1);
  expect(first.peek("/agents/a")).toMatchObject({ tail: undefined });
  await first.flush();
  expect(await (await page()).savedLogTails(owner).read("/agents/a")).toBe(undefined);
});

test.for([
  { name: "nothing cut, and the caller said exhausted", count: 5, said: true, exhausted: true },
  { name: "nothing cut, and the caller did not say so", count: 5, said: false, exhausted: false },
  { name: "the oldest event cut", count: 1_001, said: true, exhausted: false },
])("a saved tail is exhausted only when $name: $exhausted", async ({ count, said, exhausted }) => {
  await database();
  const tails = (await page()).savedLogTails(owner);
  tails.save(
    "/agents/a",
    offsets(1, count).map((at) => event(at)),
    said,
    1,
  );
  expect(tails.peek("/agents/a")).toMatchObject({ tail: { exhausted } });
});

test("another member reads nothing of the first one's tails, and its first use deletes them", async () => {
  await database();
  const first = (await page()).savedLogTails(owner);
  first.save("/agents/a", [event(1)], true, 1);
  await first.flush();
  const other = (await page()).savedLogTails({ ...owner, actor: "/members/b" });
  expect(await other.read("/agents/a")).toBe(undefined);
  expect(await (await page()).savedLogTails(owner).read("/agents/a")).toBe(undefined);
});

test("the 31st context saved deletes the one saved longest ago", async () => {
  await database();
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    const tails = (await page()).savedLogTails(owner);
    for (const at of offsets(0, 30)) {
      vi.setSystemTime(1_000 * (at + 1));
      tails.save(`/agents/${at}`, [event(1)], true, 1);
    }
    await tails.flush();
    const next = (await page()).savedLogTails(owner);
    const read = await Promise.all(["/agents/0", "/agents/1", "/agents/30"].map(next.read));
    expect(read.map((tail) => tail?.events.length)).toEqual([undefined, 1, 1]);
  } finally {
    vi.useRealTimers();
  }
});

test("drop forgets one context; a wipe deletes the database, and no save or read after it does anything", async () => {
  const indexedDB = await database();
  const first = (await page()).savedLogTails(owner);
  first.save("/agents/a", [event(1)], true, 1);
  first.save("/agents/b", [event(1)], true, 1);
  await first.flush();
  first.drop("/agents/a");
  expect(first.peek("/agents/a")).toMatchObject({ tail: undefined });
  await first.flush();
  const next = await page();
  const tails = next.savedLogTails(owner);
  expect(await tails.read("/agents/a")).toBe(undefined);
  expect(await tails.read("/agents/b")).toMatchObject({ events: [{ offset: 1 }] });
  await next.wipeSavedLogTails();
  expect(await indexedDB.databases()).toEqual([]);
  expect(tails.peek("/agents/b")).toMatchObject({ tail: undefined });
  tails.save("/agents/c", [event(1)], true, 1);
  await tails.flush();
  expect(await tails.read("/agents/c")).toBe(undefined);
  expect(await indexedDB.databases()).toEqual([]);
});

test.for([
  { name: "no IndexedDB at all", factory: undefined },
  {
    name: "an IndexedDB whose open throws",
    factory: {
      open() {
        throw new Error("SecurityError");
      },
    },
  },
])("with $name a read answers nothing and a save and a flush settle", async ({ factory }) => {
  vi.stubGlobal("indexedDB", factory);
  const tails = (await page()).savedLogTails(owner);
  expect(await tails.read("/agents/a")).toBe(undefined);
  tails.save("/agents/a", [event(1)], true, 1);
  await expect(tails.flush()).resolves.toBe(undefined);
});

test("the first save writes at once, the saves of the next 3 s write once at their end; flush writes at once", async () => {
  await database();
  const put = vi.spyOn(IDBObjectStore.prototype, "put");
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  try {
    const tails = (await page()).savedLogTails(owner);
    // a reader may reload right after the first rows came: the first tail does not wait
    tails.save("/agents/a", [event(1)], true, 1);
    // well inside the 3 s, and with no flush asked for
    await vi.waitFor(() => expect(put).toHaveBeenCalledTimes(1), { timeout: 500, interval: 10 });
    for (const at of offsets(2, 20))
      tails.save(
        "/agents/a",
        offsets(1, at).map((one) => event(one)),
        true,
        1,
      );
    await vi.advanceTimersByTimeAsync(2_000);
    expect(put).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    // the write the timer started, and nothing more waits
    await tails.flush();
    expect(put).toHaveBeenCalledTimes(2);
    tails.save(
      "/agents/a",
      offsets(1, 21).map((one) => event(one)),
      true,
      1,
    );
    await tails.flush();
    expect(put).toHaveBeenCalledTimes(3);
    const read = await (await page()).savedLogTails(owner).read("/agents/a");
    expect(read?.events).toHaveLength(21);
  } finally {
    vi.useRealTimers();
  }
});

test("a view saved with a tail is read back by a new page, and a later save of either keeps the other", async () => {
  await database();
  const first = (await page()).savedLogTails(owner);
  first.save("/agents/a", [event(1)], true, 1);
  first.saveView("/agents/a", claude("A"));
  await first.flush();
  const second = (await page()).savedLogTails(owner);
  await second.read("/agents/a");
  expect(second.peek("/agents/a")).toMatchObject({
    tail: { events: [{ offset: 1 }] },
    view: claude("A"),
  });
  // a later save of the tail keeps the view
  second.save("/agents/a", [event(1), event(2)], true, 1);
  await second.flush();
  const third = (await page()).savedLogTails(owner);
  await third.read("/agents/a");
  expect(third.peek("/agents/a")).toMatchObject({ view: claude("A") });
  // a later save of the view keeps the tail
  third.saveView("/agents/a", claude("B"));
  await third.flush();
  const fourth = (await page()).savedLogTails(owner);
  await fourth.read("/agents/a");
  expect(fourth.peek("/agents/a")).toMatchObject({
    tail: { events: [{ offset: 1 }, { offset: 2 }] },
    view: claude("B"),
  });
});

test("a view saved before its tail is written with the tail, and no view is kept or shown with no tail", async () => {
  await database();
  const first = (await page()).savedLogTails(owner);
  first.saveView("/agents/a", claude("A"));
  await vi.waitFor(() => expect(first.peek("/agents/a")).toMatchObject({ tail: undefined }));
  expect(first.peek("/agents/a")?.view).toBe(undefined);
  first.save("/agents/a", [event(1)], true, 1);
  await first.flush();
  const second = (await page()).savedLogTails(owner);
  await second.read("/agents/a");
  expect(second.peek("/agents/a")).toMatchObject({ view: claude("A") });
  // a tail with no event deletes the record, view and all
  second.save("/agents/a", [], true, 1);
  await second.flush();
  const third = (await page()).savedLogTails(owner);
  expect(await third.read("/agents/a")).toBe(undefined);
  expect(third.peek("/agents/a")).toMatchObject({ tail: undefined });
  expect(third.peek("/agents/a")?.view).toBe(undefined);
});

test("another member reads no view, and drop and a wipe remove it", async () => {
  await database();
  const first = (await page()).savedLogTails(owner);
  for (const path of ["/agents/a", "/agents/b"]) {
    first.save(path, [event(1)], true, 1);
    first.saveView(path, claude("A"));
  }
  await first.flush();
  const other = (await page()).savedLogTails({ ...owner, actor: "/members/b" });
  expect(await other.read("/agents/a")).toBe(undefined);
  expect(other.peek("/agents/a")?.view).toBe(undefined);
  const again = (await page()).savedLogTails(owner);
  // the other member's first use deleted the first one's records
  expect(await again.read("/agents/a")).toBe(undefined);
  again.save("/agents/a", [event(1)], true, 1);
  again.saveView("/agents/a", claude("A"));
  again.save("/agents/b", [event(1)], true, 1);
  again.saveView("/agents/b", claude("A"));
  await again.flush();
  again.drop("/agents/a");
  expect(again.peek("/agents/a")?.view).toBe(undefined);
  await again.flush();
  const next = await page();
  const tails = next.savedLogTails(owner);
  await tails.read("/agents/a");
  await tails.read("/agents/b");
  expect(tails.peek("/agents/a")?.view).toBe(undefined);
  expect(tails.peek("/agents/b")).toMatchObject({ view: claude("A") });
  await next.wipeSavedLogTails();
  expect(tails.peek("/agents/b")?.view).toBe(undefined);
});

test("a record whose view does not parse answers its tail with no view", async () => {
  const indexedDB = await database();
  const first = (await page()).savedLogTails(owner);
  first.save("/agents/a", [event(1)], true, 1);
  await first.flush();
  await rewrite(indexedDB, (record) => ({ ...record, view: { kind: 7, file: "claude.ts" } }));
  const second = (await page()).savedLogTails(owner);
  expect(await second.read("/agents/a")).toMatchObject({ events: [{ offset: 1 }] });
  expect(second.peek("/agents/a")).toMatchObject({ tail: { exhausted: true } });
  expect(second.peek("/agents/a")?.view).toBe(undefined);
});

test("a tail is read back with the version of its context; a save of another version replaces it", async () => {
  await database();
  const first = (await page()).savedLogTails(owner);
  first.save("/agents/a", [event(1), event(2)], true, 1);
  await first.flush();
  expect(await (await page()).savedLogTails(owner).read("/agents/a")).toMatchObject({
    version: 1,
  });
  // the same events, of the next version: no streamed chunk, another tail
  first.save("/agents/a", [event(1), event(2)], true, 2);
  expect(first.peek("/agents/a")).toMatchObject({ tail: { version: 2 } });
  await first.flush();
  expect(await (await page()).savedLogTails(owner).read("/agents/a")).toMatchObject({
    events: [{ offset: 1 }, { offset: 2 }],
    version: 2,
  });
});

test("a record with no version, as a page before versions wrote it, is not read: it may be of any version", async () => {
  const indexedDB = await database();
  const first = (await page()).savedLogTails(owner);
  first.save("/agents/a", [event(1)], true, 1);
  first.saveView("/agents/a", claude("A"));
  await first.flush();
  await rewrite(indexedDB, (record) => ({ ...record, version: undefined }));
  const second = (await page()).savedLogTails(owner);
  expect(await second.read("/agents/a")).toBe(undefined);
  expect(second.peek("/agents/a")).toMatchObject({ tail: undefined });
  expect(second.peek("/agents/a")?.view).toBe(undefined);
});

test("a kind's file over 500,000 characters is not kept: the view is not remembered", async () => {
  await database();
  const first = (await page()).savedLogTails(owner);
  first.save("/agents/a", [event(1)], true, 1);
  first.saveView("/agents/a", claude("A"));
  // a larger file replaces the kept view with none: the kept one is of an older file
  first.saveView("/agents/a", claude("x".repeat(500_001)));
  expect(first.peek("/agents/a")?.view).toBe(undefined);
  await first.flush();
  const second = (await page()).savedLogTails(owner);
  expect(await second.read("/agents/a")).toMatchObject({ events: [{ offset: 1 }] });
  expect(second.peek("/agents/a")?.view).toBe(undefined);
});

/** The pages that tests loaded and that were not ended yet. */
const pages: { wipeSavedLogTails(): Promise<void> }[] = [];

/** A new database for the test, as the browser's `indexedDB`. An earlier test's page may still
 *  have a write on its way (the first write after a quiet time starts at once): each one is ended
 *  first, so that nothing of it lands in this test's database. */
async function database() {
  for (const earlier of pages.splice(0)) await earlier.wipeSavedLogTails();
  const factory = new IDBFactory();
  vi.stubGlobal("indexedDB", factory);
  return factory;
}

/** The module as a new page loads it: no memory, the same database. */
async function page() {
  vi.resetModules();
  const loaded = await import("./saved-log-tail.ts");
  pages.push(loaded);
  return loaded;
}

function offsets(from: number, to: number) {
  return Array.from({ length: to - from + 1 }, (_, at) => from + at);
}

/** The view of a Claude agent, whose kind has a file with `source`. */
function claude(source: string) {
  return { kind: "claude", file: { name: "agent-kinds/claude.ts", source } };
}

/** Every record of the database, changed by `change`, as another version of the page could have
 *  written it. */
async function rewrite(factory: IDBFactory, change: (record: object) => object) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open("iterate-saved-log-tails");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const tails = db.transaction("tails", "readwrite").objectStore("tails");
  await new Promise<void>((resolve) => {
    const cursor = tails.openCursor();
    cursor.onsuccess = () => {
      if (!cursor.result) return resolve();
      cursor.result.update(change(cursor.result.value));
      cursor.result.continue();
    };
  });
  db.close();
}

function event(offset: number, { ephemeral = false, characters = 10 } = {}) {
  return {
    offset,
    createdAt: `2026-11-16T00:00:${String(offset % 60).padStart(2, "0")}.000Z`,
    type: "events.iterate.com/agent/context-added",
    payload: { content: "x".repeat(characters) },
    ephemeral,
  };
}
