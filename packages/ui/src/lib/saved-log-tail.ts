// saved-log-tail.ts — THE SAVED TAIL OF A CONTEXT'S LOG, in the browser's IndexedDB. A view that is
// drawn again after a reload shows at once the rows it showed last, and the mind is asked only for
// what is newer: the tail is the seed of `keptContext` (#/lib/itx-session.ts), and the offset of
// its newest event is the read's `since`. `useSavedContext` (#/lib/saved-context.ts) holds
// both for a page.
//
//   const tails = savedLogTails({ mind, actor });   one store per owner, for the life of the page
//   tails.peek(path)                                what this page knows, at once: { tail, view } or undefined
//   await tails.read(path)                          the same, else the database's: { events, exhausted }
//   tails.save(path, events, exhausted)             cheap on every change: the newest durable events
//   tails.saveView(path, { kind, file })            the view that draws the rows: a reload mounts it at once
//   tails.drop(path)                                the mind refused the context: forget it
//   await wipeSavedLogTails()                       the sign-in ended: forget everything
//
// The view is kept in the tail's record, so every rule of the tail holds for it: its owner, its
// bounds, `drop` and the wipe. A view is kept only with a tail: a record with no events is
// deleted, view and all, and `peek` answers a view only beside a tail.
//
// EVERYTHING HERE IS BEST EFFORT. A private window, a full disk or a browser without IndexedDB
// costs the speed, never the page: no call here throws or rejects, a read that fails answers
// nothing, and a save that fails is lost. The owner is the mind and the member the mind's `whoami`
// answered: the first use of a store deletes every other owner's tails, so no tail of one member
// is ever shown to another on the same browser.

import { z } from "zod";

/** The newest durable events kept of one context: as many as a first read holds at most (a page
 *  of the log), so that a reload draws what that read drew. Fewer is too few for a quiet agent:
 *  most events of its log's end are wakes and subscription rows, and its newest row lies hundreds
 *  of events back (574 on one real agent, 2026-11-16). The characters below are the real bound. */
const MOST_EVENTS = 1_000;
/** The most characters of JSON kept of one context: a Claude agent's newest page was a frame of
 *  3.1 MB (measured 2026-11-16), and a tail must stay far smaller than what it saves the reader. */
const MOST_CHARACTERS = 2_000_000;
/** The most contexts in the database: the ones a member opened last. A tail is for a reload, not
 *  an archive, so the store stays small whatever a member opens. */
const MOST_CONTEXTS = 30;
/** How often a store writes at most: a streamed answer changes the log many times a second, and a
 *  write is a structured clone of the whole tail. The first change after a quiet time is written
 *  at once (a reader may reload right after the first rows came), and a last write follows the
 *  last change. */
const WRITE_EVERY_MS = 3_000;
/** How long a read waits for the database before it answers nothing: the mind's own answer is
 *  then near, and a database that hangs must not hold the page. */
const ANSWER_WITHIN_MS = 300;
/** The most characters of a kind's file kept with a view. A larger file is not kept, and the view
 *  is then not remembered: the page waits for the mind's kinds, as on a first visit. */
const MOST_VIEW_CHARACTERS = 500_000;

const DATABASE = "iterate-saved-log-tails";
const TAILS = "tails";

/** What a store reads of an event. The rest of it is saved as it is. */
export type SavedEvent = { offset: number; createdAt?: string; ephemeral?: boolean };

/** One context's saved tail: its newest durable events, oldest first, and whether they go back to
 *  the log's first event. */
export type SavedTail = { events: readonly SavedEvent[]; exhausted: boolean };

/** The view that drew a context's rows: the agent's kind (none for a path that the mind's catalog
 *  does not list) and, for a kind with a file of its own, that file's path in the config repo and
 *  its source (null when it could not be read). */
const SavedView = z.object({
  kind: z.string().optional(),
  file: z.object({ name: z.string(), source: z.string().nullable() }).optional(),
});
export type SavedView = z.infer<typeof SavedView>;

/** Whether two views draw the same: the same kind, and the same file, by its path and its source. */
export function sameView(one: SavedView, other: SavedView) {
  return (
    one.kind === other.kind &&
    one.file?.name === other.file?.name &&
    one.file?.source === other.file?.source
  );
}

/** The store of one owner's saved tails. */
export type SavedLogTails = {
  /** What this page knows of `path`'s tail, at once: the tail it last saved or read (`tail`
   *  undefined when it knows there is none) and the view that drew it, or undefined when only the
   *  database can say. */
  peek(path: string): { tail: SavedTail | undefined; view?: SavedView } | undefined;
  /** The saved tail of `path`, from memory first, else from the database; undefined when there is
   *  none, or the database has not answered within `ANSWER_WITHIN_MS`. */
  read(path: string): Promise<SavedTail | undefined>;
  /** Keep the newest durable `events` of `path`, within the bounds. In memory at once, and in the
   *  database at once when none was written for `WRITE_EVERY_MS`, else when that time is over. */
  save(path: string, events: readonly SavedEvent[], exhausted: boolean): void;
  /** Keep the view that draws `path`'s rows, with its tail: written as `save` writes, and only
   *  when it is another view than the one kept. Before the store has read `path`, after the read. */
  saveView(path: string, view: SavedView): void;
  /** Write what waits now. Settles when it is written, or failed. */
  flush(): Promise<void>;
  /** Forget `path`, in memory and in the database. */
  drop(path: string): void;
};

/** One context's record in the database. */
const StoredTail = z.object({
  savedAt: z.number(),
  exhausted: z.boolean(),
  events: z.array(
    z.looseObject({
      offset: z.number(),
      createdAt: z.string().optional(),
      ephemeral: z.boolean().optional(),
    }),
  ),
  // parsed on its own: a view that does not parse costs the view, not the tail
  view: z.unknown().optional(),
});

type Store = SavedLogTails & { forget(): void };

/** What a page knows when it has no tails to read. */
const NOTHING = { tail: undefined };

const stores = new Map<string, Store>();
/** The tails were wiped: the page is about to leave, and no store reads or writes again. */
let wiped = false;
/** The page's one connection, opened at the first use and again after another tab closed it. */
let connection: Promise<IDBDatabase | undefined> | undefined;
let opened: IDBDatabase | undefined;
/** Each event's characters of JSON, measured once: a log keeps its events as the same objects. */
const characters = new WeakMap<object, number>();

/** The store of `mind`'s tails for the member `actor`: the same object for the life of the page,
 *  so a view that mounts again reads what the last one saved. */
export function savedLogTails({ mind, actor }: { mind: string; actor: string }): SavedLogTails {
  const name = JSON.stringify([mind, actor]);
  let store = stores.get(name);
  if (!store) {
    store = storeOf(mind, actor);
    stores.set(name, store);
    watchPageLeave();
  }
  return store;
}

/** FORGET EVERY SAVED TAIL, of every owner: the memory at once, then the database. After it, no
 *  store of this page reads or saves again. The delete starts in the call, and the promise settles
 *  when it is done, failed or blocked by another tab, or after `ANSWER_WITHIN_MS`. */
export function wipeSavedLogTails(): Promise<void> {
  wiped = true;
  for (const store of stores.values()) store.forget();
  opened?.close();
  opened = undefined;
  connection = undefined;
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ANSWER_WITHIN_MS);
    const settle = () => {
      clearTimeout(timer);
      resolve();
    };
    try {
      if (!globalThis.indexedDB) return settle();
      const request = indexedDB.deleteDatabase(DATABASE);
      request.onsuccess = settle;
      request.onerror = settle;
      request.onblocked = settle;
    } catch {
      settle();
    }
  });
}

function storeOf(mind: string, actor: string): Store {
  /** What this page saved or read, by path: `tail` undefined when there is none. */
  const memory = new Map<
    string,
    { tail: SavedTail | undefined; view: SavedView | undefined; savedAt: number }
  >();
  /** The paths whose memory the database does not have yet. */
  const dirty = new Set<string>();
  const reading = new Map<string, Promise<SavedTail | undefined>>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** When the last write started: the next one is not before `WRITE_EVERY_MS` after it. */
  let wroteAt = 0;
  let writing = Promise.resolve();
  let ready: Promise<IDBDatabase | undefined> | undefined;
  const keyOf = (path: string) => [mind, actor, path];

  /** The connection, once this owner's first use has deleted every other owner's tails. */
  const database = () =>
    (ready ||= open().then(async (db) => {
      if (!db) return undefined;
      await deleteOtherOwners(db, mind, actor);
      return db;
    }));

  const readStored = async (path: string) => {
    const db = await database();
    const tails = db && objectStore(db, "readonly");
    if (!tails) return undefined;
    let asked: IDBRequest<unknown>;
    try {
      asked = tails.get(keyOf(path));
    } catch {
      return undefined;
    }
    const record = StoredTail.safeParse(await settled(asked));
    if (!record.success) return undefined;
    const { events, exhausted, view } = record.data;
    return { tail: { events, exhausted }, view: SavedView.safeParse(view).data };
  };

  const write = async () => {
    const paths = [...dirty];
    dirty.clear();
    if (!paths.length) return;
    const db = await database();
    const tails = db && objectStore(db, "readwrite");
    if (!db || !tails || wiped) return;
    const over = done(tails.transaction);
    try {
      for (const path of paths) {
        const known = memory.get(path);
        if (known?.tail)
          tails.put({
            mind,
            actor,
            path,
            savedAt: known.savedAt,
            ...known.tail,
            view: known.view,
          });
        else tails.delete(keyOf(path));
      }
    } catch {
      // a tail the browser cannot clone or store is not saved
    }
    await over;
    await keepNewest(db);
  };

  const flush = () => {
    clearTimeout(timer);
    timer = undefined;
    wroteAt = Date.now();
    writing = writing.then(write).catch(() => {});
    return writing;
  };

  const peek = (path: string) => {
    const known = memory.get(path);
    // a view kept before its tail is written with the tail, and shown with it
    const answer = known && { tail: known.tail, view: known.tail && known.view };
    // a page that wiped, or has no database, knows that there is nothing
    if (wiped || !globalThis.indexedDB) return answer || NOTHING;
    return answer;
  };

  const read = (path: string) => {
    const known = peek(path);
    if (known) return Promise.resolve(known.tail);
    let answer = reading.get(path);
    if (!answer) {
      answer = new Promise<SavedTail | undefined>((resolve) => {
        const settle = (stored: { tail: SavedTail; view: SavedView | undefined } | undefined) => {
          clearTimeout(late);
          reading.delete(path);
          // a save or a drop meanwhile is newer than what the database had
          if (!wiped && !memory.has(path))
            memory.set(path, { tail: stored?.tail, view: stored?.view, savedAt: 0 });
          resolve(memory.get(path)?.tail);
        };
        const late = setTimeout(() => settle(undefined), ANSWER_WITHIN_MS);
        readStored(path).then(settle, () => settle(undefined));
      });
      reading.set(path, answer);
    }
    return answer;
  };

  const schedule = (path: string) => {
    dirty.add(path);
    timer ||= setTimeout(() => void flush(), Math.max(0, wroteAt + WRITE_EVERY_MS - Date.now()));
  };

  return {
    peek,
    read,
    saveView(path, view) {
      if (wiped) return;
      // a file over the bound is not kept: the view is then not remembered at all
      const kept = (view.file?.source?.length ?? 0) > MOST_VIEW_CHARACTERS ? undefined : view;
      const keep = () => {
        const known = memory.get(path);
        const same = known?.view && kept ? sameView(known.view, kept) : !known?.view && !kept;
        if (wiped || same) return;
        memory.set(path, {
          tail: known?.tail,
          view: kept,
          savedAt: known?.tail ? Date.now() : (known?.savedAt ?? 0),
        });
        // with no tail there is nothing to write: the record waits for the tail's save
        if (known?.tail) schedule(path);
      };
      // the stored record is read first, so the view lands on its tail and not beside an empty one
      if (memory.has(path)) keep();
      else void read(path).then(keep);
    },
    save(path, events, exhausted) {
      if (wiped) return;
      const tail = newestTail(events, exhausted);
      const known = memory.get(path)?.tail;
      // the same rows as the memory holds: a streamed chunk changed only ephemeral events
      if (
        known &&
        tail &&
        known.exhausted === tail.exhausted &&
        known.events.length === tail.events.length &&
        known.events[0] === tail.events[0] &&
        known.events.at(-1) === tail.events.at(-1)
      )
        return;
      // the view that drew the rows stays with them
      memory.set(path, { tail, view: memory.get(path)?.view, savedAt: Date.now() });
      schedule(path);
    },
    flush,
    drop(path) {
      if (wiped) return;
      memory.set(path, { tail: undefined, view: undefined, savedAt: Date.now() });
      dirty.add(path);
      void flush();
    },
    forget() {
      clearTimeout(timer);
      timer = undefined;
      memory.clear();
      dirty.clear();
    },
  };
}

/** The newest durable events within the bounds, oldest first; undefined when none fits.
 *  `exhausted` stays only when no durable event was cut. */
function newestTail(events: readonly SavedEvent[], exhausted: boolean): SavedTail | undefined {
  // an ephemeral event is never in the log again: a copy of one would show what a read cannot
  const durable = events.filter((event) => event.ephemeral !== true);
  let from = durable.length;
  let total = 0;
  while (from > 0 && durable.length - from < MOST_EVENTS) {
    const more = total + charactersOf(durable[from - 1]!);
    if (more > MOST_CHARACTERS) break;
    total = more;
    from -= 1;
  }
  if (from === durable.length) return undefined;
  return { events: durable.slice(from), exhausted: exhausted && from === 0 };
}

function charactersOf(event: SavedEvent) {
  let size = characters.get(event);
  if (size === undefined) {
    try {
      size = JSON.stringify(event).length;
    } catch {
      // not JSON: never saved
      size = Infinity;
    }
    characters.set(event, size);
  }
  return size;
}

/** The page's connection, or undefined when there is no database. Another tab that wipes asks
 *  this one to close (`versionchange`): it closes, and the stores that used it write no more. The
 *  sign-in that ended there ends here too, and this page is reloaded. */
function open(): Promise<IDBDatabase | undefined> {
  if (wiped) return Promise.resolve(undefined);
  connection ||= new Promise<IDBDatabase | undefined>((resolve) => {
    try {
      if (!globalThis.indexedDB) return resolve(undefined);
      const request = indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = () => {
        try {
          const tails = request.result.createObjectStore(TAILS, {
            keyPath: ["mind", "actor", "path"],
          });
          tails.createIndex("savedAt", "savedAt");
        } catch {
          // the open fails, and answers nothing
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        if (wiped) {
          db.close();
          return resolve(undefined);
        }
        opened = db;
        db.onversionchange = () => {
          db.close();
          if (opened === db) {
            opened = undefined;
            connection = undefined;
          }
        };
        resolve(db);
      };
      request.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
  return connection;
}

/** The tails of every other mind and member go, chosen by their keys alone. */
async function deleteOtherOwners(db: IDBDatabase, mind: string, actor: string) {
  const tails = objectStore(db, "readwrite");
  if (!tails) return;
  const over = done(tails.transaction);
  try {
    const keys = tails.openKeyCursor();
    keys.onsuccess = () => {
      const cursor = keys.result;
      if (!cursor) return;
      const key = cursor.primaryKey;
      if (!Array.isArray(key) || key[0] !== mind || key[1] !== actor)
        tails.delete(cursor.primaryKey);
      cursor.continue();
    };
    keys.onerror = () => {};
  } catch {
    // the other owners' tails stay until the next page
  }
  await over;
}

/** The contexts saved longest ago go, by the index on `savedAt`, until `MOST_CONTEXTS` are left.
 *  One transaction, kept alive by its own callbacks: an `await` inside it could let it end. */
async function keepNewest(db: IDBDatabase) {
  const tails = objectStore(db, "readwrite");
  if (!tails) return;
  const over = done(tails.transaction);
  try {
    const count = tails.count();
    count.onsuccess = () => {
      let extra = count.result - MOST_CONTEXTS;
      if (extra <= 0) return;
      const keys = tails.index("savedAt").openKeyCursor();
      keys.onsuccess = () => {
        const cursor = keys.result;
        if (!cursor || extra <= 0) return;
        tails.delete(cursor.primaryKey);
        extra -= 1;
        cursor.continue();
      };
      keys.onerror = () => {};
    };
    count.onerror = () => {};
  } catch {
    // the database stays larger until the next write
  }
  await over;
}

function objectStore(db: IDBDatabase, mode: IDBTransactionMode) {
  try {
    return db.transaction(TAILS, mode).objectStore(TAILS);
  } catch {
    // a connection that is closing
    return undefined;
  }
}

/** A request's result, or undefined when it failed. */
function settled<T>(request: IDBRequest<T>) {
  return new Promise<T | undefined>((resolve) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(undefined);
  });
}

/** Settles when the transaction is over, however it ended. */
function done(transaction: IDBTransaction) {
  return new Promise<void>((resolve) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => resolve();
    transaction.onabort = () => resolve();
  });
}

let watching = false;
/** A page that leaves, or goes to the back, writes what waits: it may never come back. */
function watchPageLeave() {
  if (watching || !globalThis.addEventListener) return;
  watching = true;
  const flushAll = () => {
    for (const store of stores.values()) void store.flush();
  };
  addEventListener("pagehide", flushAll);
  if (globalThis.document)
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flushAll();
    });
}
