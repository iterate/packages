// The Dash's two views of a context, as links from any page: the agent view (`?agent=<path>`, on
// the page with id `agents`) and the raw view (`?page=<id>&context=<path>`).
import { pageHref } from "#/lib/page-url.ts";

/** The agent view of `path`, from any page. */
export function agentViewHref(path: string) {
  return pageHref(undefined, { agent: path });
}

/** The raw view of `path` on the page `page` (the Dash's Contexts page): `/` too is named, as a
 *  page with no `?context` opens no context. */
export function rawViewHref(page: string, path: string) {
  return pageHref(page, { context: path });
}
