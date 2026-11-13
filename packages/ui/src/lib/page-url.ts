// page-url.ts — THE URL OF A PAGE WITH NO ROUTER, as a no-build app with several pages keeps it:
// `?page=<id>` is the page (none: the app's first page), each page has keys of its own
// (`?context=<path>`), and `?view=<json>` holds what the page's own view keeps (a filter, an open
// file, an open sheet). A link changes the URL in place, so Back and a new tab work as on any site.
//
//   const page = usePageParam("page");
//   <a {...linkTo(pageHref("repo"))}>Config repo</a>
//   const { view, patchView } = useView();
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { z } from "zod";
import { plainLeftClick } from "#/lib/plain-left-click.ts";

const subscribe = (listener: () => void) => {
  addEventListener("popstate", listener);
  return () => removeEventListener("popstate", listener);
};

/** The page's query string, live: a component that reads it draws again when a link or Back
 *  changes it. */
export function useSearch(): string {
  return useSyncExternalStore(
    subscribe,
    () => location.search,
    () => "",
  );
}

/** One key of the query string, live; null when it is not there. */
export function usePageParam(name: string): string | null {
  const search = useSearch();
  return useMemo(() => new URLSearchParams(search).get(name), [search, name]);
}

/** This URL with `change` applied: a key set to undefined (or "") is dropped. "./" when nothing is
 *  left. */
export function hrefOf(change: Record<string, string | undefined>, search = location.search) {
  const next = new URLSearchParams(search);
  for (const [key, value] of Object.entries(change))
    if (value) next.set(key, value);
    else next.delete(key);
  const query = next.toString();
  return query ? `?${query}` : "./";
}

/** The link to a page: its id and its own keys, and none of the last page's. `page` undefined is
 *  the app's first page. */
export function pageHref(page: string | undefined, keys: Record<string, string | undefined> = {}) {
  return hrefOf({ page, ...keys }, "");
}

/** Go to `href` on this page: a new entry in the history, or the same entry changed. */
export function go(href: string, replace?: boolean) {
  if (replace) history.replaceState(null, "", href);
  else history.pushState(null, "", href);
  dispatchEvent(new PopStateEvent("popstate"));
}

/** What makes an `<a>` a link that stays on this page: a plain left click changes the URL in
 *  place, and any other click is the browser's (a new tab). */
export function linkTo(href: string) {
  return {
    href,
    onClick: (event: Parameters<typeof plainLeftClick>[0] & { preventDefault(): void }) => {
      if (!plainLeftClick(event)) return;
      event.preventDefault();
      go(href);
    },
  };
}

/** `?view=<json>` as an object ({} when it is absent or not JSON), and the two ways to change it.
 *  `patchView` merges, drops a key set to undefined and replaces the history's entry, so Back
 *  leaves the page and not each keystroke. `setView` writes the whole view, as a new entry unless
 *  `replace`: an open sheet is an entry, and Back closes it. */
export function useView() {
  const search = useSearch();
  const view = useMemo(() => viewOf(search), [search]);
  const setView = useCallback((next: Record<string, unknown>, replace?: boolean) => {
    go(hrefOf({ view: Object.keys(next).length ? JSON.stringify(next) : undefined }), replace);
  }, []);
  const patchView = useCallback(
    (patch: Record<string, unknown>) =>
      setView(
        Object.fromEntries(
          Object.entries({ ...view, ...patch }).filter(([, value]) => value !== undefined),
        ),
        true,
      ),
    [view, setView],
  );
  return { view, patchView, setView };
}

const View = z.record(z.string(), z.unknown());

function viewOf(search: string): Record<string, unknown> {
  try {
    return View.safeParse(JSON.parse(new URLSearchParams(search).get("view") || "{}")).data || {};
  } catch {
    return {}; // a hand-edited value: no view state
  }
}
