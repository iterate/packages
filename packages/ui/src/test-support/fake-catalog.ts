// A MIND'S CATALOG IN MEMORY, for a test of what watches it (components/context-catalog): it
// answers `contexts.watch` as iterate/api says a watch does. The first frame is a `reset`, or a
// `resume` for a cursor of this generation and this query; then one `change` for each write that
// changes the answer, and the frames of one write are one batch (`more: true` on all but the last).
import {
  compareCatalogRows,
  type CatalogCursor,
  type CatalogItx,
  type CatalogQuery,
  type CatalogRow,
} from "#/components/context-catalog/catalog-collection.ts";
import { ITX_SESSION, type ItxConnection } from "#/lib/itx-session.ts";

type Awake = { path: string; since: number };
type Row = CatalogRow | Awake;
type Watching = {
  query: CatalogQuery;
  onFrame: (frame: unknown) => void;
  /** path → the revision that this watcher was sent (0 for an awake row). */
  sent: Map<string, number>;
  rev: number;
};

/** A catalog in memory, and the `itx` of a page that watches it. */
export function fakeCatalog() {
  const rows = new Map<string, CatalogRow>();
  const awake = new Map<string, Awake>();
  const watching = new Set<Watching>();
  const calls: { query: CatalogQuery; cursor?: CatalogCursor }[] = [];
  let rev = 0;
  let gen = "g1";
  let connection: ItxConnection = { epoch: 1, state: "open" };
  const sessionListeners = new Set<() => void>();

  const revOf = (row: Row) => ("rev" in row ? row.rev : 0);
  function answerOf(query: CatalogQuery): Row[] {
    if (query.awake) return [...awake.values()];
    if (query.keys) return query.keys.flatMap((key) => rows.get(key) ?? []);
    const order = query.order || "active";
    return [...rows.values()]
      .filter((row) =>
        Object.entries(query.where || {}).every(([fact, value]) => {
          if (fact === "$processor") return row.processors.includes(String(value));
          const held = row.metadata?.[fact];
          return Array.isArray(held) ? held.includes(value) : held === value;
        }),
      )
      .filter((row) => !query.under || row.path.startsWith(query.under))
      .toSorted((a, b) => compareCatalogRows(a, b, order))
      .slice(0, query.limit ?? 50);
  }
  /** Sends each watcher what one write changed for it, as one batch. */
  function publish() {
    const frames: [Watching, object][] = [];
    for (const watch of watching) {
      const answer = answerOf(watch.query);
      const paths = new Set(answer.map((row) => row.path));
      const del = [...watch.sent.keys()].filter((path) => !paths.has(path));
      const put = answer.filter((row) => watch.sent.get(row.path) !== revOf(row));
      if (del.length + put.length === 0) continue;
      for (const path of del) watch.sent.delete(path);
      for (const row of put) watch.sent.set(row.path, revOf(row));
      frames.push([watch, { type: "change", gen, from: watch.rev, rev, del, rows: put }]);
      watch.rev = rev;
    }
    frames.forEach(([watch, frame], index) => {
      watch.onFrame(index < frames.length - 1 ? { ...frame, more: true } : frame);
    });
  }

  const itx: CatalogItx & { [ITX_SESSION]: unknown } = {
    [ITX_SESSION]: {
      get: () => connection,
      subscribe(changed: () => void) {
        sessionListeners.add(changed);
        return () => sessionListeners.delete(changed);
      },
      watch: () => () => {},
    },
    contexts: {
      async watch(query, onFrame, options) {
        calls.push({ query, ...(options?.cursor && { cursor: options.cursor }) });
        await Promise.resolve();
        if (query.where && "refused" in query.where)
          throw Object.assign(new Error("the catalog refuses this"), { code: "INVALID_INPUT" });
        const q = JSON.stringify(query);
        const answer = answerOf(query);
        const watch: Watching = {
          query,
          onFrame,
          rev,
          sent: new Map(answer.map((row) => [row.path, revOf(row)])),
        };
        watching.add(watch);
        const cursor = options?.cursor;
        if (cursor?.gen === gen && cursor.q === q) {
          const have = new Set(cursor.have);
          const lacks = (row: Row) => {
            if (revOf(row) > cursor.rev) return true;
            if (cursor.have) return !have.has(row.path);
            if (!cursor.bound) return true;
            const [at, path] = cursor.bound;
            const order = query.order || "active";
            const last = { path, activeMs: at, createdMs: at };
            return compareCatalogRows(row, last, order) > 0;
          };
          onFrame({
            type: "resume",
            gen,
            rev,
            q,
            full: answer.length === query.limit,
            ids: answer.map((row) => row.path),
            rows: answer.filter(lacks),
          });
        } else
          onFrame({
            type: "reset",
            gen,
            rev,
            q,
            full: answer.length === query.limit,
            rows: answer,
          });
        return {
          [Symbol.dispose]: () => {
            watching.delete(watch);
          },
        };
      },
    },
  };

  return {
    itx,
    calls,
    watching,
    put(path: string, activeMs: number, more: Partial<CatalogRow> = {}) {
      rev += 1;
      rows.set(path, {
        path,
        activeMs,
        createdMs: rows.get(path)?.createdMs ?? activeMs,
        rev,
        eventCount: 1,
        eventTypes: {},
        recentTypes: [],
        processors: [],
        metadata: {},
        ...more,
      });
      publish();
    },
    /** One write that changes a context's row and wakes it. */
    putAwake(path: string, activeMs: number) {
      awake.set(path, { path, since: activeMs });
      this.put(path, activeMs);
    },
    remove(path: string) {
      rev += 1;
      rows.delete(path);
      publish();
    },
    /** The socket closes, and a new session opens: every watch of the old one is gone. */
    newSession({ newGeneration = false } = {}) {
      watching.clear();
      if (newGeneration) gen = "g2";
      connection = { epoch: connection.epoch + 1, state: "open" };
      for (const changed of sessionListeners) changed();
    },
    /** A frame that the catalog never sent: the next change then comes with a gap. */
    skipFrame() {
      rev += 1;
    },
  };
}
