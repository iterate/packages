// context-catalog-live.ts — THE CATALOG'S ROWS FOR A PAGE, PUSHED: the hook that the Dash reads
// the catalog with. The catalog is TanStack DB collections over `itx.contexts.watch`
// (catalog-collection.ts), and the rows are one live query: the 500 most recently active
// contexts, joined by path with the awake list for the dots and the activities.
//
//   const { rows, error } = useWatchedContextCatalog(itx, () => itx.contexts.list({ limit: 500 }), {
//     of: mind,
//   });
//
// A page's own query of the catalog is a live query of `catalogOf(itx).contexts`:
//
//   const { data } = useLiveQuery({ query: (q) =>
//     q.from({ c: catalogOf(itx).contexts }).where(({ c }) => inArray("pinned", c.metadata.tags)) });
//
// A MIND WHOSE PLATFORM HAS NO `contexts.watch` refuses the first watch. The hook then reads the
// catalog as before, with `list` every ten seconds (`useContextCatalog`), and says no error.
import {
  BasicIndex,
  createCollection,
  createLiveQueryCollection,
  eq,
  useLiveQuery,
} from "@tanstack/react-db";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import {
  CatalogAwakeRow,
  catalogWatcher,
  CATALOG_WINDOW_LIMIT,
  compareCatalogRows,
  contextsCollectionOptions,
  watchedQueryCollectionOptions,
  type CatalogItx,
  type CatalogWatcher,
} from "./catalog-collection.ts";
import { useContextCatalog } from "./context-catalog-list.tsx";
import type { ContextListing } from "./context-catalog-rows.ts";

/** A window's order and a join's key are read through an index of the rows that are here. */
const INDEXED = { defaultIndexType: BasicIndex, autoIndex: "eager" } as const;

function collectionsOf(watcher: CatalogWatcher) {
  /** The whole catalog, on demand: a live query of it is a query of the catalog. */
  const contexts = createCollection(contextsCollectionOptions({ watcher, index: INDEXED }));
  /** The contexts that have work now. A join reads it by path, through an index. */
  const awake = createCollection(
    watchedQueryCollectionOptions({
      watcher,
      query: { awake: true },
      row: CatalogAwakeRow,
      index: INDEXED,
    }),
  );
  // The window is a live query of its own, so that the catalog is asked for these rows and no
  // more: a join that orders and limits is asked for its whole left side.
  const recent = createLiveQueryCollection((q) =>
    q
      .from({ context: contexts })
      .orderBy(({ context }) => context.activeMs, "desc")
      .limit(CATALOG_WINDOW_LIMIT),
  );
  /** The rows that every page of a Dash shows: the window, each row with its awake row. */
  const listings = createLiveQueryCollection((q) =>
    q
      .from({ context: recent })
      .join({ awake }, ({ context, awake: row }) => eq(context.path, row.path), "left"),
  );
  return { contexts, awake, listings };
}

/** One mind's catalog as a page holds it: the watcher, and the collections that read through it. */
export type MindCatalog = { watcher: CatalogWatcher } & Readonly<ReturnType<typeof collectionsOf>>;

const catalogs = new WeakMap<object, MindCatalog>();

/** THE CATALOG OF ONE MIND, for the life of the page, whoever asks: one watcher and one set of
 *  collections for an `itx`. A collection that no query reads holds no watch. WHEN THE CATALOG
 *  IS A SOURCE AGAIN after it was none, the collections are made anew: a watch that the catalog
 *  refused has ended, and its collection would hold rows that nothing keeps true. So read
 *  `catalogOf(itx).contexts` where the query is written, and keep no collection in a variable. */
export function catalogOf(itx: CatalogItx): MindCatalog {
  const held = catalogs.get(itx);
  if (held) return held;
  const watcher = catalogWatcher(itx);
  let collections = collectionsOf(watcher);
  let wasNone = false;
  // for the page's life, as the watcher is: nothing ends this subscription
  watcher.subscribe(() => {
    const support = watcher.support();
    if (support === "none") wasNone = true;
    if (support !== "live" || !wasNone) return;
    wasNone = false;
    collections = collectionsOf(watcher);
  });
  const made: MindCatalog = {
    watcher,
    get contexts() {
      return collections.contexts;
    },
    get awake() {
      return collections.awake;
    },
    get listings() {
      return collections.listings;
    },
  };
  catalogs.set(itx, made);
  return made;
}

/** The catalog's rows, pushed by the mind: the 500 most recently active contexts, the newest
 *  first, each with `awake` and `activities` when it has work now. `rows` is undefined until the
 *  first answer. While the catalog is no source (`CatalogSupport`: a platform without
 *  `contexts.watch`, a catalog that cannot be reached) the rows are `list`'s, asked again every
 *  `pollMs` (`useContextCatalog`). `of` names whose catalog it is (the mind's address). */
export function useWatchedContextCatalog(
  itx: CatalogItx,
  list: () => PromiseLike<unknown>,
  { of, pollMs }: { of: string; pollMs?: number },
): { rows: ContextListing[] | undefined; error: string | undefined } {
  const catalog = catalogOf(itx);
  const support = useSyncExternalStore(
    catalog.watcher.subscribe,
    catalog.watcher.support,
    catalog.watcher.support,
  );
  // WHETHER THE CATALOG IS A SOURCE is asked before a collection reads anything: a refusal is
  // then an answer here, and no failed load of a query. While the page reads the list, it asks
  // again each minute: after a deploy the catalog cannot be reached for up to a minute, and a
  // session at its limit of watches gets room again.
  useEffect(() => {
    if (support === "asking") catalog.watcher.probe();
    if (support !== "none") return;
    const timer = setInterval(() => {
      catalog.watcher.probe();
    }, 60_000);
    return () => {
      clearInterval(timer);
    };
  }, [catalog, support]);
  const polled = useContextCatalog(support === "none" ? list : null, { of, pollMs });
  const listings = support === "live" ? catalog.listings : undefined;
  const live = useLiveQuery({
    query: (q) => (listings ? q.from({ listing: listings }) : undefined),
  });
  const data = live.isReady ? live.data : undefined;
  const rows = useMemo(
    () =>
      data
        ?.map(({ context, awake }): ContextListing & { activeMs: number } => ({
          ...context,
          ...(awake && { awake: { since: awake.since } }),
          ...(awake?.activities && { activities: awake.activities }),
        }))
        .toSorted((a, b) => compareCatalogRows(a, b)),
    [data],
  );
  if (support === "none") return polled;
  return {
    rows,
    error: live.isLoadingError ? "The mind did not answer the catalog's query." : undefined,
  };
}
