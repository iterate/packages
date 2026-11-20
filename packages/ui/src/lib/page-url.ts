// page-url.ts — THE URL OF A PAGE WITH NO ROUTER, for a no-build app with several pages:
// an app names its path scheme once (`pathAddresses`), and each page reads `usePageParam` and
// builds links with `pageHref` and `useView` (`?view=<json>` holds view state like filters or
// open sheets). Without a registered scheme, keys live in the query string.
//
//   const page = usePageParam("page");
//   <a {...linkTo(pageHref("repo"))}>Config repo</a>
//   const { view, patchView } = useView();
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { z } from "zod";
import { plainLeftClick } from "#/lib/plain-left-click.ts";

/** How an app keeps its keys in the URL's path. The two functions are each other's reverse:
 *  `keysOf` reads what `hrefOf` wrote. */
export type PathAddresses = {
  /** Every key of the address: the path's and the query's. */
  keysOf(pathname: string, search: string): URLSearchParams;
  /** The address that holds `keys`: a path from the root, with the keys the path cannot say in
   *  its query. */
  hrefOf(keys: URLSearchParams): string;
};

let named: PathAddresses | undefined;

/** Names the app's path scheme, once, before it draws. */
export function pathAddresses(scheme: PathAddresses) {
  named = scheme;
}

/** The keys of `address`, a path with its query. */
function keysAt(address: string) {
  const cut = address.indexOf("?");
  const search = cut < 0 ? "" : address.slice(cut);
  return (
    named?.keysOf(cut < 0 ? address : address.slice(0, cut), search) || new URLSearchParams(search)
  );
}

/** The address that holds `keys`, as a link on this page. */
function hrefWith(keys: URLSearchParams) {
  if (named) return named.hrefOf(keys);
  const query = keys.toString().replaceAll("%2F", "/");
  return query ? `?${query}` : "./";
}

/** Splits an href into `[address, hash]` so hash fragments survive path normalisation. */
function splitHash(href: string): [string, string] {
  const cut = href.indexOf("#");
  if (cut < 0) return [href, ""];
  return [href.slice(0, cut), href.slice(cut)];
}

/** `href` as this app writes it. With a path scheme, `./` and any root path accepted by
 *  `keysOfLink` are normalised to their canonical address, keeping any hash. */
function written(href: string) {
  if (!named) return href;
  const [address, hash] = splitHash(href);
  if (address === "./") return `${named.hrefOf(named.keysOf("/", ""))}${hash}`;
  const keys = keysOfLink(address);
  if (!keys) return href;
  return `${named.hrefOf(keys)}${hash}`;
}

/** The keys of a link that stays on this page, or null for a link to another place. With a path
 *  scheme, a path from the root stays; without one, only a query does. */
export function keysOfLink(href: string): URLSearchParams | null {
  const [address] = splitHash(href);
  if (named) return address.startsWith("/") && !address.startsWith("//") ? keysAt(address) : null;
  return address.startsWith("?") ? keysAt(`/${address}`) : null;
}

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

/** The page's address, its path with its query, live: what changes when a link or Back does. */
export function useAddress(): string {
  return useSyncExternalStore(
    subscribe,
    () => location.pathname + location.search,
    () => "/",
  );
}

/** One key of the address, live; null when it is not there. */
export function usePageParam(name: string): string | null {
  const address = useAddress();
  return useMemo(() => keysAt(address).get(name), [address, name]);
}

/** This URL with `change` applied: a key set to undefined (or "") is dropped. "./" when nothing is
 *  left. A slash stays a slash, which a query may hold as it is: `?context=/agents/onboarding`
 *  reads as the path it names. `from`: the keys to start from, in place of this URL's. With
 *  paths, the answer is a path from the root. */
export function hrefOf(
  change: Record<string, string | undefined>,
  from: string | URLSearchParams = keysAt(location.pathname + location.search),
) {
  const next = new URLSearchParams(from);
  for (const [key, value] of Object.entries(change))
    if (value) next.set(key, value);
    else next.delete(key);
  return hrefWith(next);
}

/** The link to a page: its id and its own keys, and none of the last page's. `page` undefined is
 *  the app's first page. */
export function pageHref(page: string | undefined, keys: Record<string, string | undefined> = {}) {
  return hrefOf({ page, ...keys }, "");
}

/** Go to `href` on this page: a new entry in the history, or the same entry changed. */
export function go(href: string, replace?: boolean) {
  const to = written(href);
  if (replace) history.replaceState(null, "", to);
  else history.pushState(null, "", to);
  dispatchEvent(new PopStateEvent("popstate"));
}

/** What makes an `<a>` a link that stays on this page: a plain left click changes the URL in
 *  place, and any other click is the browser's (a new tab). */
export function linkTo(href: string) {
  const to = written(href);
  return {
    href: to,
    onClick: (event: Parameters<typeof plainLeftClick>[0] & { preventDefault(): void }) => {
      if (!plainLeftClick(event)) return;
      event.preventDefault();
      go(to);
    },
  };
}

/** `?view=<json>` as an object ({} when it is absent or not JSON), and the two ways to change it.
 *  `patchView` merges, drops a key set to undefined and replaces the history's entry, so Back
 *  leaves the page and not each keystroke. `setView` writes the whole view, as a new entry unless
 *  `replace`: an open sheet is an entry, and Back closes it. */
export function useView() {
  const address = useAddress();
  const view = useMemo(() => viewOf(keysAt(address)), [address]);
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

function viewOf(keys: URLSearchParams): Record<string, unknown> {
  try {
    return View.safeParse(JSON.parse(keys.get("view") || "{}")).data || {};
  } catch {
    return {}; // a hand-edited value: no view state
  }
}
