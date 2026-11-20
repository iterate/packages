// Registers the Dash's canonical path addresses (`dashPaths`) on `page-url.ts`. Every part of
// the Dash imports this module; non-Dash components that only format a Dash URL import `dashPaths`
// from `#/components/dash/dash-paths.ts` instead so their own app stays in query mode.
import { dashPaths } from "#/components/dash/dash-paths.ts";
import { pageHref, pathAddresses } from "#/lib/page-url.ts";

export { dashPaths };

/** The agent view of `path`, from any page. */
export function agentViewHref(path: string) {
  return pageHref(undefined, { agent: path });
}

/** The raw view of `path` on the page `page` (the Dash's Contexts page): `/` too is named, as a
 *  page with no context opens no context. */
export function rawViewHref(page: string, path: string) {
  return pageHref(page, { context: path });
}

// every part of the Dash imports this file, so the paths are named before the Dash draws
pathAddresses(dashPaths);
