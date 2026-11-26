// catalog-collection.ts — THE MIND'S CATALOG AS TANSTACK DB COLLECTIONS, over the page's one
// socket. The catalog answers a query for as long as a watcher holds it
// (`itx.contexts.watch(query, onFrame, { cursor })`, iterate/api `CatalogQuery`), and pushes each
// change. Nothing here polls, and nothing here opens a socket. No React here, and no import of
// TanStack DB but its types: each function answers a plain config for `createCollection`.
//
//   const watcher = catalogWatcher(itx);
//   const contexts = createCollection(contextsCollectionOptions({ watcher }));
//   const awake = createCollection(watchedQueryCollectionOptions({
//     watcher, query: { awake: true }, row: CatalogAwakeRow }));
//   const recent = createLiveQueryCollection((q) =>
//     q.from({ c: contexts }).orderBy(({ c }) => c.activeMs, "desc").limit(500));
//   const rows = createLiveQueryCollection((q) =>
//     q.from({ c: recent }).leftJoin({ a: awake }, ({ c, a }) => eq(c.path, a.path)));
//
// `contextsCollectionOptions` is THE WHOLE CATALOG AS ONE ON-DEMAND COLLECTION. A page writes an
// ordinary live query, TanStack DB hands its filter, order and limit to this file (`loadSubset`),
// and this file turns them into ONE catalog query and watches it. So the page's own query is the
// registration: the catalog learns it at run time.
//
// What a live query may say, and what it becomes:
//   eq(c.metadata.<fact>, value)            → where: { <fact>: value }
//   inArray(value, c.metadata.<fact>)       → where: { <fact>: value }   (a fact that is a list)
//   inArray(name, c.processors)             → where: { $processor: name }
//   eq(c.parent, path)                      → childrenOf: path
//   inArray(path, c.under)                  → under: path                (a path and all below it)
//   eq(c.path, path), inArray(c.path, [..]) → keys: [..]                 (what a JOIN asks for)
//   and(...) of the above, limit(n), and one order:
//     orderBy(c.activeMs, "desc") | orderBy(c.createdMs, "desc") | orderBy(c.path, "asc")
// Anything else with a limit is REFUSED with the reason: the catalog would have to guess, and a
// guessed window gives wrong rows. With no limit, the facts go to the catalog and TanStack DB
// filters the rest in the page.
//
// THE CATALOG'S MATCH OF A FACT IS WIDER THAN THE PAGE'S: it matches a value as its text (`1` and
// `"1"`) and as an item of a list. TanStack DB filters the rows again with the query's own `eq`
// or `inArray`, which are strict. So write the form that the stored value has: `eq` for a scalar,
// `inArray(value, c.metadata.x)` for a list, a number for a number. A window with a limit whose
// query uses the other form holds rows that the page then drops, and shows fewer rows than exist.
// `eq(c.activeMs, x)` and `eq(c.createdMs, x)` load no row: they are what TanStack DB asks for
// the rows that tie with a window's last, which the catalog has sent already.
//
// A MIND WHOSE PLATFORM HAS NO `contexts.watch` refuses the first watch: `watcher.support()` then
// says "none", and the page reads the catalog as before (`useContextCatalog` polls
// `contexts.list`).
import type { CollectionConfig, LoadSubsetOptions, SyncConfig, UtilsRecord } from "@tanstack/db";
import { z } from "zod";
import { ContextActivity } from "./context-activity-stack.ts";
import { ContextListing } from "./context-catalog-rows.ts";
import { itxSessionOf } from "#/lib/itx-session.ts";

// ── what the catalog says (iterate/api) ──

/** The orders of a watched window. Each is total: the path breaks a tie. `active` and `created`
 *  are the newest first, with the path descending; `path` is A to Z. */
export type CatalogOrder = "active" | "created" | "path";

/** A query of the catalog that is watched (iterate/api `CatalogQuery`): a window, exactly these
 *  `keys`, or the contexts that are `awake` now. */
export type CatalogQuery = {
  where?: Record<string, string | number | boolean>;
  under?: string;
  childrenOf?: string;
  order?: CatalogOrder;
  limit?: number;
  keys?: string[];
  awake?: true;
};

/** What a watcher holds of a query, for a watch that starts again (iterate/api `CatalogCursor`). */
export type CatalogCursor = {
  gen: string;
  rev: number;
  q: string;
  bound?: [at: number, path: string] | null;
  have?: string[];
};

/** One context as a watch sends it (iterate/api `CatalogRow`): a listing without `awake` and
 *  `activities`, with the two numbers that the orders sort by and the catalog's revision at which
 *  the row last changed. `activeMs` is when it was last active (`lastActivityAt || lastEventAt`)
 *  and `createdMs` when its first event was written, in milliseconds. A row changes at each
 *  summary that its context sends: at most one in 15 s while it works. */
export const CatalogRow = ContextListing.omit({ awake: true, activities: true }).extend({
  activeMs: z.number(),
  createdMs: z.number(),
  rev: z.number(),
});
export type CatalogRow = z.infer<typeof CatalogRow>;

/** One row of the awake list (`{ awake: true }`): it has no revision. */
export const CatalogAwakeRow = z.looseObject({
  path: z.string(),
  since: z.number(),
  activities: z.array(ContextActivity).optional(),
});
export type CatalogAwakeRow = z.infer<typeof CatalogAwakeRow>;

/** A frame without its rows, which each watch parses as its own kind of row. */
const Frame = z.intersection(
  z.object({ gen: z.string(), rev: z.number(), more: z.literal(true).optional() }),
  z.discriminatedUnion("type", [
    z.object({
      type: z.literal("reset"),
      q: z.string(),
      full: z.boolean(),
      rows: z.array(z.unknown()),
    }),
    z.object({
      type: z.literal("resume"),
      q: z.string(),
      full: z.boolean(),
      ids: z.array(z.string()),
      rows: z.array(z.unknown()),
    }),
    z.object({
      type: z.literal("change"),
      from: z.number(),
      del: z.array(z.string()),
      rows: z.array(z.unknown()),
    }),
  ]),
);

/** What this file calls of a member's `itx`. */
export type CatalogItx = {
  contexts: {
    watch(
      query: CatalogQuery,
      onFrame: (frame: unknown) => void,
      options?: { cursor?: CatalogCursor },
    ): PromiseLike<CatalogWatchHandle>;
  };
};

/** What `contexts.watch` answers: disposing it ends the watch. `ended()` settles when the watch
 *  ends WITHOUT that (its session ended, or the catalog could not be reached again). */
export type CatalogWatchHandle = Disposable & { ended?(): PromiseLike<unknown> };

// ── the order ──

/** As the catalog orders paths: by UTF-8 bytes, which is SQLite's BINARY collation. JavaScript's
 *  own `<` differs for one case: an astral character against U+E000 to U+FFFF. */
export function compareTextBinary(a: string, b: string): number {
  if (a === b) return 0;
  const shared = Math.min(a.length, b.length);
  for (let i = 0; i < shared; i++) {
    const x = a.charCodeAt(i);
    const y = b.charCodeAt(i);
    if (x === y) continue;
    const xSurrogate = x >= 0xd800 && x <= 0xdfff;
    const ySurrogate = y >= 0xd800 && y <= 0xdfff;
    if (xSurrogate === ySurrogate) return x < y ? -1 : 1;
    return xSurrogate ? 1 : -1;
  }
  return a.length < b.length ? -1 : 1;
}

type Sortable = { path: string; activeMs?: number; createdMs?: number };

/** A row's sort key in `order`, as a cursor's `bound` says it. */
function sortKeyOf(row: Sortable, order: CatalogOrder): [at: number, path: string] {
  if (order === "path") return [0, row.path];
  return [(order === "created" ? row.createdMs : row.activeMs) ?? 0, row.path];
}

/** The catalog's order of two rows of a window. */
export function compareCatalogRows(a: Sortable, b: Sortable, order: CatalogOrder = "active") {
  if (order === "path") return compareTextBinary(a.path, b.path);
  const [x] = sortKeyOf(a, order);
  const [y] = sortKeyOf(b, order);
  return x !== y ? y - x : -compareTextBinary(a.path, b.path);
}

// ── the watcher: every query of this page, over the page's one socket ──

/** What a watch tells its holder after each frame is in `rows`: the paths that left and the rows
 *  that came or changed. `answer` marks the answer to a watch that started. `error` is a refusal:
 *  the watch has ended. */
export type CatalogChange<Row> = {
  del: string[];
  put: Row[];
  answer?: true;
  /** The answer is the whole truth (a `reset`): a row's revision may be one that this page has
   *  seen for other content, since a catalog that made its tables again counts from 0. */
  whole?: true;
  error?: string;
};

/** One query that the catalog keeps answering. `rows` is its answer now. */
export type CatalogWatch<Row> = {
  readonly query: CatalogQuery;
  readonly rows: ReadonlyMap<string, Row>;
  /** True when a window is at its limit: more rows may match than it holds. */
  readonly full: boolean;
  /** How many answers have come: 0 until the first. */
  readonly answers: number;
  /** How many change frames have been applied. */
  readonly frames: number;
  readonly error: string | undefined;
  /** Resolves with the first answer, and rejects with a refusal's reason. */
  readonly ready: Promise<void>;
  stop(): void;
};

/** Whether the mind's catalog answers a watch: "asking" until the first frame or the first
 *  refusal, then "live". "none" while it is no source: a platform without `contexts.watch`
 *  (`NOT_A_METHOD`), a catalog that could not be reached (`UNAVAILABLE`) or that failed (an error
 *  with no code), or a watch that lost its place three times in half a minute. The page then
 *  reads the list, and `probe()` asks again. `INVALID_INPUT` (this query cannot be answered) and
 *  `WATCH_LIMIT` (the session has 64 watches, or the mind 512 live queries) refuse one watch
 *  and say nothing of the catalog. */
export type CatalogSupport = "asking" | "live" | "none";

export type CatalogWatcher = {
  /** Asks the catalog to answer `query` from now on. `row` parses each row. `like` is another
   *  watch of the same kind whose rows are here: the new watch starts from them and from its
   *  cursor, so the catalog sends only the rows that the other does not hold. */
  watch<Row extends { path: string }>(
    query: CatalogQuery,
    row: z.ZodType<Row>,
    onChange: (change: CatalogChange<Row>) => void,
    like?: CatalogWatch<Row>,
  ): CatalogWatch<Row>;
  /** `end()` runs after the last frame of each batch. One write of the catalog is one batch over
   *  all of this page's queries, so a holder applies it as one transaction. */
  onBatch(end: () => void): () => void;
  /** True between a frame that says `more` and the end of its batch. */
  batchOpen(): boolean;
  support(): CatalogSupport;
  /** Asks, with one watch of the awake list that ends with its answer, whether the catalog is a
   *  source now: `support()` then says "live", or "none" for any refusal. A page asks at its
   *  start, and again later while it reads the list. */
  probe(): void;
  /** For `useSyncExternalStore`: `changed` runs when `support()` answers another word. */
  subscribe(changed: () => void): () => void;
  /** Ends every watch and leaves the session. */
  close(): void;
};

/** A watch that lost its place (a change frame is missing, or the catalog ended it) starts again.
 *  Two such starts within half a minute are allowed. A third means that the catalog is no source
 *  now: the watcher then says "none", and the page reads the list. */
const RESTARTS_ALLOWED = 2;

/** A refusal's code, which the platform sends as the error's own property. */
const Coded = z.object({ code: z.string() });

const kindOf = (query: CatalogQuery) => (query.keys ? "keys" : query.awake ? "awake" : "window");

type Held<Row> = {
  query: CatalogQuery;
  row: z.ZodType<Row>;
  onChange: (change: CatalogChange<Row>) => void;
  rows: Map<string, Row>;
  gen: string | undefined;
  rev: number;
  q: string | undefined;
  full: boolean;
  answers: number;
  frames: number;
  /** How many times it started again of late, and when the first of those was. */
  restarts: number;
  restartedAt: number;
  error: string | undefined;
  /** The start that this watch listens to: a frame of an earlier start is of no watch. */
  start: object | undefined;
  handle: PromiseLike<CatalogWatchHandle> | undefined;
  ready: Promise<void>;
  resolveReady(): void;
  rejectReady(error: Error): void;
  stop(): void;
};

/** THE CATALOG'S WATCHES OF ONE PAGE. A watch is of one session and ends with it: when a new
 *  session opens, each watch starts again with its cursor, and the catalog sends every path of
 *  the answer and only the rows that this page lacks. */
export function catalogWatcher(itx: CatalogItx): CatalogWatcher {
  const session = itxSessionOf(itx);
  const watches = new Set<Held<{ path: string }>>();
  const batchEnds = new Set<() => void>();
  const supportListeners = new Set<() => void>();
  let support: CatalogSupport = "asking";
  /** The session that a call made now goes with. A call made before the first socket is open
   *  (epoch 0) waits for that socket, so it is of the first session. */
  const sessionNow = () => Math.max(session.get().epoch, 1);
  let epoch = 1;

  const say = (next: CatalogSupport) => {
    if (support === next) return;
    support = next;
    for (const changed of supportListeners) changed();
  };

  function cursorOf(held: Held<{ path: string }>): CatalogCursor | undefined {
    if (!held.gen || !held.q) return undefined;
    const kind = kindOf(held.query);
    if (kind === "awake") return undefined;
    const base = { gen: held.gen, rev: held.rev, q: held.q };
    if (kind === "keys") return { ...base, have: [...held.rows.keys()] };
    const order = held.query.order || "active";
    const last = [...held.rows.values()].toSorted((a, b) => compareCatalogRows(a, b, order)).at(-1);
    return { ...base, bound: last ? sortKeyOf(last, order) : null };
  }

  // ONE WRITE IS ONE BATCH: every frame but the last says `more`. A batch also gets an end of
  // this page's own, since the catalog cuts a very long message in two and a frame can be lost
  // with its session: a transaction must not stay open.
  let batchTimer: ReturnType<typeof setTimeout> | undefined;
  const endBatch = () => {
    clearTimeout(batchTimer);
    batchTimer = undefined;
    for (const end of batchEnds) end();
  };

  function refuse(held: Held<{ path: string }>, error: string) {
    held.error = error;
    release(held);
    held.rejectReady(new Error(error));
    held.onChange({ del: [], put: [], error });
  }

  /** Ends the catalog's side of a watch: the handle, when the call has answered. */
  function release(held: Held<{ path: string }>) {
    const handle = held.handle;
    held.start = undefined;
    held.handle = undefined;
    // a call that failed left nothing to end
    void Promise.resolve(handle).then(
      (answered) => answered?.[Symbol.dispose](),
      () => {},
    );
  }

  function start(held: Held<{ path: string }>) {
    release(held);
    const started = {};
    held.start = started;
    const asked = sessionNow();
    const cursor = cursorOf(held);
    let handle: PromiseLike<CatalogWatchHandle>;
    try {
      handle = itx.contexts.watch(
        held.query,
        (frame) => {
          receive(held, started, frame);
        },
        cursor ? { cursor } : undefined,
      );
    } catch (caught) {
      handle = Promise.reject(caught);
    }
    held.handle = handle;
    void Promise.resolve(handle).then(undefined, (caught: unknown) => {
      if (held.start !== started) return;
      // the session went away under the call: its next epoch starts the watch again
      if (sessionNow() !== asked || session.get().state !== "open") return;
      // INVALID_INPUT and WATCH_LIMIT refuse this watch alone. Any other refusal says that the
      // catalog is no source now (`CatalogSupport`).
      const code = Coded.safeParse(caught).data?.code;
      if (code !== "INVALID_INPUT" && code !== "WATCH_LIMIT") say("none");
      refuse(held, caught instanceof Error ? caught.message : String(caught));
    });
    // The catalog ended the watch and this page did not: watch again. A session that went away
    // rejects here, and its next epoch starts the watch.
    void Promise.resolve(handle)
      // a platform whose handle has no `ended` never says that a watch ended
      .then((answered) => (answered.ended ? answered.ended() : new Promise<never>(() => {})))
      .then(
        () => {
          if (held.start === started && session.get().state === "open")
            startAgain(held, "the catalog ended the watch three times in half a minute");
        },
        () => {},
      );
  }

  /** A window is full when it holds its limit: more rows may match than it holds. */
  const fullOf = (held: Held<{ path: string }>) =>
    kindOf(held.query) === "window" && held.rows.size >= (held.query.limit || 50);

  /** Starts a watch that lost its place, or gives the catalog up with `reason`. */
  function startAgain(held: Held<{ path: string }>, reason: string) {
    const now = Date.now();
    if (now - held.restartedAt > 30_000) {
      held.restarts = 0;
      held.restartedAt = now;
    }
    if (held.restarts >= RESTARTS_ALLOWED) {
      say("none");
      refuse(held, reason);
      return;
    }
    held.restarts += 1;
    start(held);
  }

  function receive(held: Held<{ path: string }>, started: object, raw: unknown) {
    const parsed = Frame.safeParse(raw);
    const current = held.start === started;
    if (current) {
      if (parsed.success) apply(held, parsed.data);
      else {
        say("none");
        refuse(held, "the catalog sent a frame that this page cannot read");
      }
    }
    // The batch ends with its last frame, whoever that frame was for.
    if (parsed.success && parsed.data.more) {
      clearTimeout(batchTimer);
      batchTimer = setTimeout(endBatch, 50);
    } else endBatch();
  }

  function apply(held: Held<{ path: string }>, frame: z.infer<typeof Frame>) {
    if (support === "asking") say("live");
    const rows = frame.rows.flatMap((value) => {
      const row = held.row.safeParse(value);
      return row.success ? [row.data] : [];
    });
    if (frame.type === "change") {
      // before its answer a watch has no revision that a change could follow
      if (held.gen !== frame.gen || held.rev !== frame.from) {
        startAgain(held, "the catalog's changes came with a gap three times in half a minute");
        return;
      }
      for (const path of frame.del) held.rows.delete(path);
      for (const row of rows) held.rows.set(row.path, row);
      held.rev = frame.rev;
      held.frames += 1;
      held.full = fullOf(held);
      held.onChange({ del: frame.del, put: rows });
      return;
    }
    // An answer: every row (`reset`, which may come at any time and is the whole truth), or every
    // path with only the rows that this page lacks (`resume`).
    const keep = new Set(frame.type === "reset" ? rows.map((row) => row.path) : frame.ids);
    const del = [...held.rows.keys()].filter((path) => !keep.has(path));
    for (const path of del) held.rows.delete(path);
    for (const row of rows) held.rows.set(row.path, row);
    held.gen = frame.gen;
    held.rev = frame.rev;
    held.q = frame.q;
    held.full = frame.full;
    held.error = undefined;
    held.answers += 1;
    held.onChange({ del, put: rows, answer: true, ...(frame.type === "reset" && { whole: true }) });
    held.resolveReady();
  }

  // A new session: every watch of the last one ended with it. The watcher is in the session's
  // list only while it holds a watch, since a page with a subscriber is one that lives on over
  // a new session (#/lib/itx-session.ts).
  let probing = false;
  let leave: (() => void) | undefined;
  const follow = () => {
    epoch = sessionNow();
    leave ||= session.subscribe(() => {
      const now = sessionNow();
      if (now === epoch) return;
      epoch = now;
      for (const held of watches) if (!held.error) start(held);
    });
  };
  const unfollow = () => {
    if (watches.size > 0) return;
    leave?.();
    leave = undefined;
  };

  return {
    watch<Row extends { path: string }>(
      query: CatalogQuery,
      row: z.ZodType<Row>,
      onChange: (change: CatalogChange<Row>) => void,
      like?: CatalogWatch<Row>,
    ): CatalogWatch<Row> {
      const settle = Promise.withResolvers<void>();
      // a watch that nobody waits for must not end as an unhandled rejection
      settle.promise.catch(() => {});
      const held: Held<Row> = {
        query,
        row,
        onChange,
        rows: new Map(),
        gen: undefined,
        rev: -1,
        q: undefined,
        full: false,
        answers: 0,
        frames: 0,
        restarts: 0,
        restartedAt: 0,
        error: undefined,
        start: undefined,
        handle: undefined,
        ready: settle.promise,
        resolveReady: settle.resolve,
        rejectReady: settle.reject,
        stop() {
          if (!watches.delete(erased)) return;
          release(erased);
          // whoever waits for its first answer hears that none comes
          settle.reject(new Error("the watch was stopped"));
          unfollow();
        },
      };
      // The set holds watches of every kind of row. A watch reads and writes its rows through
      // its own `row` parser and its own `onChange`, so the set's one type forgets nothing that
      // is used.
      const erased = held as unknown as Held<{ path: string }>;
      const from = like as (CatalogWatch<Row> & Partial<Held<Row>>) | undefined;
      if (from?.gen && kindOf(from.query) === kindOf(query)) {
        held.rows = new Map(from.rows);
        held.gen = from.gen;
        held.rev = from.rev ?? -1;
        held.q = from.q;
      }
      watches.add(erased);
      follow();
      start(erased);
      return held;
    },
    onBatch(end) {
      batchEnds.add(end);
      return () => batchEnds.delete(end);
    },
    batchOpen: () => Boolean(batchTimer),
    support: () => support,
    probe() {
      if (probing) return;
      probing = true;
      const asked = this.watch({ awake: true }, z.object({ path: z.string() }), () => {});
      void asked.ready
        .then(
          () => {
            say("live");
          },
          () => {
            say("none");
          },
        )
        .finally(() => {
          probing = false;
          asked.stop();
        });
    },
    subscribe(changed) {
      supportListeners.add(changed);
      return () => supportListeners.delete(changed);
    },
    close() {
      for (const held of watches) release(held);
      watches.clear();
      unfollow();
    },
  };
}

// ── a live query's request as a catalog query ──

/** A catalog row as a page's queries see it: with `parent` and `under` (the path and each of its
 *  ancestors), so that the tree is two ordinary fields. */
export type ContextRow = CatalogRow & { parent: string; under: string[] };

export function contextRow(row: CatalogRow): ContextRow {
  const under = ["/"];
  let prefix = "";
  for (const part of row.path.split("/").filter(Boolean)) under.push((prefix += `/${part}`));
  const cut = row.path.lastIndexOf("/");
  const parent = row.path === "/" ? "" : cut <= 0 ? "/" : row.path.slice(0, cut);
  return { ...row, parent, under };
}

type Expression = NonNullable<LoadSubsetOptions["where"]>;
type Scalar = string | number | boolean;

const isRef = (node: Expression | undefined, ...path: string[]) =>
  node?.type === "ref" &&
  node.path.length === path.length &&
  node.path.every((part, index) => part === path[index]);
const isScalar = (value: unknown): value is Scalar =>
  typeof value === "string" || typeof value === "number" || typeof value === "boolean";
/** The field that a reference names, when it is a fact: `metadata.<fact>`. */
const factOf = (node: Expression) =>
  node.type === "ref" && node.path.length === 2 && node.path[0] === "metadata"
    ? node.path[1]
    : undefined;

const ORDER_FIELDS = { activeMs: "active", createdMs: "created", path: "path" } as const;

type Part =
  | { keys: string[] }
  | { tie: true }
  | { fact: [name: string, value: Scalar] }
  | { under: string }
  | { childrenOf: string };

/** What one condition asks of the catalog, or undefined when the catalog has no index for it. */
function partOf(node: Expression): Part | undefined {
  if (node.type !== "func") return undefined;
  const [a, b] = node.args;
  if (!a || !b) return undefined;
  if (node.name === "eq") {
    const [ref, other] = a.type === "ref" ? [a, b] : [b, a];
    if (ref.type !== "ref" || other.type !== "val") return undefined;
    const value: unknown = other.value;
    if (!isScalar(value)) return undefined;
    if (isRef(ref, "path")) return typeof value === "string" ? { keys: [value] } : undefined;
    // the rows that tie with a window's last row: the catalog's order is total, so it sent them
    if (isRef(ref, "activeMs") || isRef(ref, "createdMs")) return { tie: true };
    if (isRef(ref, "parent")) return typeof value === "string" ? { childrenOf: value } : undefined;
    const fact = factOf(ref);
    return fact ? { fact: [fact, value] } : undefined;
  }
  if (node.name !== "in") return undefined;
  if (isRef(a, "path") && b.type === "val") {
    const keys = z.array(z.string()).safeParse(b.value);
    return keys.success ? { keys: keys.data } : undefined;
  }
  if (a.type !== "val" || b.type !== "ref") return undefined;
  const value: unknown = a.value;
  if (!isScalar(value)) return undefined;
  if (isRef(b, "under")) return typeof value === "string" ? { under: value } : undefined;
  if (isRef(b, "processors")) return { fact: ["$processor", value] };
  const fact = factOf(b);
  return fact ? { fact: [fact, value] } : undefined;
}

const conjunctsOf = (node: Expression | undefined): Expression[] =>
  !node
    ? []
    : node.type === "func" && node.name === "and"
      ? node.args.flatMap(conjunctsOf)
      : [node];

/** The catalog's order that a live query's `orderBy` says, or undefined when it says none of
 *  the three. The path may follow as the tie-break, in the leading field's direction. */
function orderOf(orderBy: LoadSubsetOptions["orderBy"]): CatalogOrder | undefined {
  const [first, second, ...more] = orderBy || [];
  if (!first || more.length > 0 || first.expression.type !== "ref") return undefined;
  const [field, ...deeper] = first.expression.path;
  if (deeper.length > 0 || !field || !Object.hasOwn(ORDER_FIELDS, field)) return undefined;
  const order = ORDER_FIELDS[field as keyof typeof ORDER_FIELDS];
  const direction = order === "path" ? "asc" : "desc";
  if (first.compareOptions.direction !== direction) return undefined;
  if (second && (order === "path" || !isRef(second.expression, "path"))) return undefined;
  if (second && second.compareOptions.direction !== direction) return undefined;
  return order;
}

/** The largest window that the catalog serves. */
export const CATALOG_WINDOW_LIMIT = 500;

/** A live query's request as a catalog query: `{ query }`, or `{ keys }` for rows by key, or
 *  `{ nothing: true }` when the catalog has already sent the rows. `after` marks a request for
 *  the rows after a row that is here. Throws, with the reason, for a request that the catalog
 *  cannot answer exactly. */
export function catalogQueryOf(
  options: LoadSubsetOptions,
):
  | { nothing: true }
  | { keys: string[] }
  | { query: CatalogQuery; unlimited: boolean; after?: true } {
  const facts: [string, Scalar][] = [];
  const place: { under?: string; childrenOf?: string } = {};
  let keys: string[] | undefined;
  let unindexed = 0;
  for (const node of conjunctsOf(options.where)) {
    const part = partOf(node);
    if (!part) unindexed += 1;
    else if ("tie" in part) return { nothing: true };
    else if ("keys" in part) {
      const asked = new Set(part.keys);
      keys = keys ? keys.filter((key) => asked.has(key)) : part.keys;
    } else if ("fact" in part) facts.push(part.fact);
    else if ("under" in part && !place.under) place.under = part.under;
    else if ("childrenOf" in part && !place.childrenOf) place.childrenOf = part.childrenOf;
    // a second `under` or a second parent: the catalog takes one, the page checks the other
    else unindexed += 1;
  }
  // rows by key: every other condition is checked in the page, over exactly these rows
  if (keys) return keys.length > 0 ? { keys: [...new Set(keys)] } : { nothing: true };
  // one spelling for one query, whatever the order of its conditions
  const sorted = facts.toSorted(([x], [y]) => compareTextBinary(x, y));
  const filter: CatalogQuery = {
    ...(sorted.length > 0 && { where: Object.fromEntries(sorted) }),
    ...place,
  };
  if (options.limit === undefined)
    return { query: { ...filter, limit: CATALOG_WINDOW_LIMIT }, unlimited: true };

  if (unindexed > 0)
    throw new Error(
      "the catalog has no index for a condition of this query, and a limit over a guessed set gives wrong rows: use facts (eq(c.metadata.x, value)), or drop the limit",
    );
  const order = orderOf(options.orderBy);
  if (!order)
    throw new Error(
      'the catalog keeps three orders: a query with a limit says orderBy(c.activeMs, "desc"), orderBy(c.createdMs, "desc") or orderBy(c.path, "asc")',
    );
  if (options.limit > CATALOG_WINDOW_LIMIT)
    throw new Error(`the catalog's largest window is ${String(CATALOG_WINDOW_LIMIT)} rows`);
  const query = { ...filter, order, limit: options.limit };
  // the rows after a row that is here: TanStack DB asks for them when a window holds fewer rows
  // than its limit
  if (options.cursor || options.offset) return { query, unlimited: false, after: true };
  return { query, unlimited: false };
}

// ── the collections ──

/** What `contextsCollectionOptions` shows of itself: each catalog query in use. */
export type CatalogDemand = { query: CatalogQuery; rows: number; full: boolean; frames: number };

/** A collection's own indexes, which the caller names: this file imports no code of TanStack DB. */
export type CatalogIndexing = Pick<
  CollectionConfig<{ path: string }, string>,
  "defaultIndexType" | "autoIndex"
>;

type SyncParams<Row extends object> = Parameters<SyncConfig<Row, string>["sync"]>[0];

/** THE WHOLE CATALOG AS ONE ON-DEMAND COLLECTION (this file's header says what a live query of
 *  it may ask). `collection.utils.demands()` lists the catalog queries in use. */
export function contextsCollectionOptions({
  watcher,
  id,
  index,
}: {
  watcher: CatalogWatcher;
  id?: string;
  /** How TanStack DB reads the rows that are here by a field (a window's order, a join's key):
   *  its `BasicIndex` with `autoIndex: "eager"`. Without it a read scans the rows, and says so
   *  on the console. */
  index?: CatalogIndexing;
}): CollectionConfig<ContextRow, string, never, { demands: () => CatalogDemand[] }> {
  type Demand = { watch: CatalogWatch<CatalogRow>; holds: number; unlimited: boolean };
  /** Each catalog query in use, by its JSON: its watch, and how many requests hold it. */
  const demands = new Map<string, Demand>();
  /** The rows that joins asked for by key, each with how many requests hold it. All of them are
   *  ONE catalog query, sent again when the set changes: a session has few watches (64), and
   *  the catalog then sends only the new rows. */
  const keyHolds = new Map<string, number>();
  const keysDemand: {
    watch: CatalogWatch<CatalogRow> | undefined;
    settled: Promise<void>;
    scheduled: boolean;
  } = { watch: undefined, settled: Promise.resolve(), scheduled: false };
  /** path → the demands that hold the row. A row that no demand holds leaves the collection:
   *  nothing would keep it true. */
  const holders = new Map<string, Set<object>>();
  const describe = (): CatalogDemand[] =>
    [...[...demands.values()].map((demand) => demand.watch), keysDemand.watch].flatMap((watch) =>
      watch
        ? [{ query: watch.query, rows: watch.rows.size, full: watch.full, frames: watch.frames }]
        : [],
    );

  return {
    id,
    ...index,
    getKey: (row) => row.path,
    syncMode: "on-demand",
    utils: { demands: describe },
    sync: {
      rowUpdateMode: "full",
      sync: ({
        begin,
        write,
        commit,
        markReady,
        reportError,
        reportHealthy,
        collection,
      }: SyncParams<ContextRow>) => {
        // One batch of the catalog is one write over ALL of this page's queries: it becomes one
        // transaction here, so a join of two of this collection's queries never sees half of it.
        let open = false;
        let receipt: ReturnType<typeof commit> = true;
        /** What the open transaction wrote: path → the row's revision, or false when deleted. */
        const written = new Map<string, number | false>();
        const transaction = () => {
          if (!open) begin();
          open = true;
        };
        const finish = () => {
          if (!open) return;
          // closed before the commit: TanStack DB may ask for another subset inside it
          open = false;
          written.clear();
          receipt = commit();
        };
        const stopBatches = watcher.onBatch(finish);
        const revOf = (path: string) =>
          written.has(path) ? written.get(path) : (collection.get(path)?.rev ?? false);
        const hold = (demand: object, row: CatalogRow, whole: boolean) => {
          const held = holders.get(row.path) ?? new Set();
          holders.set(row.path, held);
          held.add(demand);
          const now = revOf(row.path);
          // a row of a whole answer is written whatever its revision says (`CatalogChange`)
          if (now === row.rev && !whole) return;
          transaction();
          const value = contextRow(row);
          if (now === false) write({ type: "insert", value });
          else write({ type: "update", value });
          written.set(row.path, row.rev);
        };
        const release = (demand: object, path: string) => {
          const held = holders.get(path);
          held?.delete(demand);
          if (held?.size) return;
          holders.delete(path);
          if (revOf(path) === false) return;
          transaction();
          write({ type: "delete", key: path });
          written.set(path, false);
        };
        const apply = (
          demand: object,
          watch: () => CatalogWatch<CatalogRow> | undefined,
          change: CatalogChange<CatalogRow>,
        ) => {
          if (change.error) return;
          for (const path of change.del) release(demand, path);
          // an answer is the query's whole set: also the rows that the cursor said are here
          const rows = change.answer ? (watch()?.rows.values() ?? change.put) : change.put;
          for (const row of rows) hold(demand, row, Boolean(change.whole));
        };
        /** A query with no limit shows every row that matches, or says that it cannot: the
         *  catalog holds 500 of them, and takes the least active out when one more enters. */
        const tooMany = new Map<object, Error>();
        const checkAll = (demand: Demand) => {
          if (!demand.unlimited) return;
          const said = tooMany.get(demand);
          if (demand.watch.full && !said) {
            const error = new Error(
              `more than ${String(demand.watch.rows.size - 1)} rows match a query with no limit, and the catalog holds ${String(demand.watch.rows.size)}: say an order and a limit`,
            );
            tooMany.set(demand, error);
            reportError(error);
          } else if (!demand.watch.full && said) {
            tooMany.delete(demand);
            reportHealthy(said);
          }
        };
        const end = (demand: object, watch: CatalogWatch<CatalogRow> | undefined) => {
          watch?.stop();
          for (const path of watch?.rows.keys() ?? []) release(demand, path);
        };

        /** Sends the one query for every key in demand, once for any number of requests. */
        const sendKeys = async () => {
          keysDemand.scheduled = false;
          const keys = [...keyHolds.keys()].toSorted(compareTextBinary);
          const before = keysDemand.watch;
          if (keys.length === 0) {
            keysDemand.watch = undefined;
            end(keysDemand, before);
            // a batch that is open commits at its own end
            if (!watcher.batchOpen()) finish();
            return;
          }
          if (JSON.stringify(before?.query.keys) === JSON.stringify(keys)) return;
          // The watch before stays, and its rows stay true, when the catalog cannot take this one.
          if (keys.length > CATALOG_WINDOW_LIMIT)
            throw new Error(
              `the joins of this page ask for ${String(keys.length)} contexts by path, and the catalog watches ${String(CATALOG_WINDOW_LIMIT)} at most: join fewer rows`,
            );
          const watch = watcher.watch(
            { keys },
            CatalogRow,
            (change) => {
              apply(keysDemand, () => watch, change);
            },
            before,
          );
          keysDemand.watch = watch;
          // the new query's answer names every row it holds: what only the old one held goes
          before?.stop();
        };
        /** Until the keys watch that is current has answered. A load that waited for a watch
         *  which another load replaced waits for the newer one. */
        const keysAnswered = async (): Promise<void> => {
          const watch = keysDemand.watch;
          if (!watch) return;
          try {
            await watch.ready;
          } catch (caught) {
            if (keysDemand.watch === watch) throw caught;
          }
          if (keysDemand.watch !== watch) return keysAnswered();
        };
        const demandKeys = (keys: readonly string[], by: 1 | -1) => {
          for (const key of keys) {
            const count = (keyHolds.get(key) ?? 0) + by;
            if (count > 0) keyHolds.set(key, count);
            else keyHolds.delete(key);
          }
          if (keysDemand.scheduled) return keysDemand.settled;
          keysDemand.scheduled = true;
          keysDemand.settled = Promise.resolve().then(sendKeys).then(keysAnswered);
          // an unload waits for nothing: its refusal is the load's to hear
          keysDemand.settled.catch(() => {});
          return keysDemand.settled;
        };
        const visible = async () => {
          if (receipt !== true) await receipt;
        };

        markReady();
        return {
          loadSubset: (options) => {
            const asked = catalogQueryOf(options);
            if ("nothing" in asked) return true;
            if ("keys" in asked) return demandKeys(asked.keys, 1).then(visible);
            const key = JSON.stringify(asked.query);
            // another limit of the same facts and order
            const { limit: _limit, ...facts } = asked.query;
            const same = JSON.stringify(facts);
            const like = [...demands.values()].find(({ watch }) => {
              const { limit: _other, ...other } = watch.query;
              return JSON.stringify(other) === same;
            })?.watch;
            if (asked.after) {
              // The catalog keeps a window whole: when a row leaves it, the frame that says so
              // brings the row that enters. So the rows after a window's last are never the
              // page's to ask for.
              if (like && like.answers > 0) return true;
              throw new Error("the catalog serves a window from its start: ask for a larger limit");
            }
            let demand = demands.get(key);
            if (!demand) {
              // it starts from the rows that are here
              const made: Demand = {
                holds: 0,
                unlimited: asked.unlimited,
                watch: watcher.watch(
                  asked.query,
                  CatalogRow,
                  (change) => {
                    apply(made, () => made.watch, change);
                    checkAll(made);
                  },
                  like,
                ),
              };
              demand = made;
              demands.set(key, demand);
            }
            demand.holds += 1;
            const { watch } = demand;
            if (watch.answers > 0 && receipt === true) return true;
            return watch.ready.then(visible);
          },
          unloadSubset: (options) => {
            let asked: ReturnType<typeof catalogQueryOf>;
            try {
              asked = catalogQueryOf(options);
            } catch {
              // a request that was refused holds nothing
              return;
            }
            if ("nothing" in asked) return;
            if ("keys" in asked) return void demandKeys(asked.keys, -1);
            // a request for the rows after a row took no watch
            if (asked.after) return;
            const key = JSON.stringify(asked.query);
            const demand = demands.get(key);
            if (!demand) return;
            demand.holds -= 1;
            if (demand.holds > 0) return;
            demands.delete(key);
            const said = tooMany.get(demand);
            tooMany.delete(demand);
            if (said) reportHealthy(said);
            end(demand, demand.watch);
            // a batch that is open commits at its own end
            if (!watcher.batchOpen()) finish();
          },
          cleanup: () => {
            stopBatches();
            for (const demand of demands.values()) demand.watch.stop();
            keysDemand.watch?.stop();
            keysDemand.watch = undefined;
            demands.clear();
            keyHolds.clear();
            holders.clear();
          },
        };
      },
    },
  };
}

/** ONE CATALOG QUERY AS ONE COLLECTION, for a page that names the catalog query itself: the awake
 *  list, or a window shown as it is. `row` parses each row. */
export function watchedQueryCollectionOptions<Row extends { path: string }>({
  watcher,
  id,
  query,
  row,
  index,
}: {
  watcher: CatalogWatcher;
  id?: string;
  query: CatalogQuery;
  row: z.ZodType<Row>;
  /** As `contextsCollectionOptions` takes it. */
  index?: CatalogIndexing;
}): CollectionConfig<Row, string, never, UtilsRecord> {
  return {
    id,
    ...index,
    getKey: (value) => value.path,
    sync: {
      rowUpdateMode: "full",
      sync: ({ begin, write, commit, markReady, fail, collection }: SyncParams<Row>) => {
        // The rows wait in an open transaction for the end of their batch, as the on-demand
        // collection's do. A transaction is of one collection, so one write of the catalog is
        // two commits in ONE TURN: a query that joins the two runs twice, and a page that draws
        // after the turn (React does) never draws half of a write.
        let open = false;
        const stopBatches = watcher.onBatch(() => {
          if (!open) return;
          open = false;
          pending.clear();
          commit();
          markReady();
        });
        const pending = new Map<string, boolean>();
        const here = (path: string) => pending.get(path) ?? collection.has(path);
        const watch = watcher.watch(query, row, ({ del, put, error }) => {
          if (error) {
            fail(new Error(error));
            return;
          }
          if (!open) begin();
          open = true;
          // what the open transaction did is not in the collection yet
          for (const path of del)
            if (here(path)) {
              write({ type: "delete", key: path });
              pending.set(path, false);
            }
          for (const value of put) {
            write({ type: here(value.path) ? "update" : "insert", value });
            pending.set(value.path, true);
          }
        });
        return () => {
          stopBatches();
          watch.stop();
        };
      },
    },
  };
}
