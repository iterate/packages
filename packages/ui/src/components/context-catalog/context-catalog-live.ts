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
} from "./catalog-collection.ts";
import { useContextCatalog } from "./context-catalog-list.tsx";
import type { ContextListing } from "./context-catalog-rows.ts";

/** A window's order and a join's key are read through an index of the rows that are here. */
const INDEXED = { defaultIndexType: BasicIndex, autoIndex: "eager" } as const;

function collectionsOf(itx: CatalogItx) {
  const watcher = catalogWatcher(itx);
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
  return { watcher, contexts, awake, listings };
}

const catalogs = new WeakMap<object, ReturnType<typeof collectionsOf>>();

/** THE CATALOG OF ONE MIND, for the life of the page, whoever asks: one watcher and one set of
 *  collections for an `itx`. A collection that no query reads holds no watch. */
export function catalogOf(itx: CatalogItx): ReturnType<typeof collectionsOf> {
  const held = catalogs.get(itx) ?? collectionsOf(itx);
  catalogs.set(itx, held);
  return held;
}

/** The catalog's rows, pushed by the mind: the 500 most recently active contexts, the newest
 *  first, each with `awake` and `activities` when it has work now. `rows` is undefined until the
 *  first answer. On a platform without `contexts.watch` the rows are `list`'s, asked again every
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
  // WHETHER THE MIND ANSWERS A WATCH is asked with one watch of the awake list, before a
  // collection reads anything: a refusal is then an answer here, and no failed load of a query.
  // The watch ends with the answer, and the awake collection then starts its own.
  useEffect(() => {
    if (support !== "asking") return;
    const asked = catalog.watcher.watch({ awake: true }, CatalogAwakeRow, () => {});
    return () => {
      asked.stop();
    };
  }, [catalog, support]);
  const polled = useContextCatalog(support === "none" ? list : null, { of, pollMs });
  const live = useLiveQuery({
    query: (q) => (support === "live" ? q.from({ listing: catalog.listings }) : undefined),
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
