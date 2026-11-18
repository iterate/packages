// The Dash's two views of a context, as links from any page: the agent view (`?agent=<path>`, on
// the page with id `agents`) and the raw view (`?page=<id>&context=<path>`).
//
// THE DASH'S ADDRESSES AS PATHS, on a page that asks for them (`lib/page-url`):
//
//   /                          the first page
//   /secrets                   the page with id `secrets`: the first segment is always a page's id
//   /agents/onboarding         the agent view of that path: an agent's path is the URL's path
//   /contexts/repos/config     the raw view of `/repos/config`: the path follows the page's id
//
// A context's path is never read from the root of the URL, so a page and a context cannot have
// one address: `/secrets` is the page, and the context `/secrets` is `/contexts/secrets`. Every
// other key stays in the query (`?view=`, `?repo=`), and so does a value that the path cannot say:
// the root context (`/contexts?context=/`), the agent view of a path that is not under `/agents/`
// (`/?agent=/people/ada`), and a page whose id is a path of the Dash's host (`/?page=itx`).
import { pageHref, pathAddresses, type PathAddresses } from "#/lib/page-url.ts";

/** The agent view of `path`, from any page. */
export function agentViewHref(path: string) {
  return pageHref(undefined, { agent: path });
}

/** The raw view of `path` on the page `page` (the Dash's Contexts page): `/` too is named, as a
 *  page with no `?context` opens no context. */
export function rawViewHref(page: string, path: string) {
  return pageHref(page, { context: path });
}

/** A context path as a URL's path: each segment encoded, but for the characters a URL's path
 *  holds as they are (`ada+notes@example.com`, `a:b`). */
const urlPathOf = (path: string) =>
  path
    .split("/")
    .map(encodeURIComponent)
    .join("/")
    .replace(/%(?:40|3A|24|26|2B|2C|3B|3D)/g, decodeURIComponent);

/** The context path that a URL's path names: each segment decoded (one that is no encoding is
 *  itself), with no empty segment, so `/agents/` is `/agents`. */
function contextPathOf(pathname: string) {
  const segments = pathname.split("/").filter(Boolean).map(decoded);
  return `/${segments.join("/")}`;
}

function decoded(segment: string) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** A path that a URL's path can say and `contextPathOf` reads back: from the root, with no empty,
 *  `.` or `..` segment (a browser resolves those away), and not the root itself. */
const sayable = (path: string) =>
  path.length > 1 &&
  path.startsWith("/") &&
  path
    .slice(1)
    .split("/")
    .every((segment) => segment && segment !== "." && segment !== "..");

/** A page id that can be the first segment: a plain word that is no path of the Dash's own host
 *  (`/itx` is the page's socket and `/connect/<app>` begins a connect; a file's name has a dot,
 *  and `/.auth/` and the platform's own paths start with one). */
const PAGE_SEGMENT = /^(?!(?:itx|connect)$)[A-Za-z0-9][A-Za-z0-9_-]*$/;

export const dashPaths: PathAddresses = {
  keysOf(pathname, search) {
    const keys = new URLSearchParams(search);
    // an old link names its page in the query, and reads as it always did, from any path
    if (keys.has("page") || keys.has("agent")) return keys;
    const path = contextPathOf(pathname);
    if (path === "/") return keys;
    if (path.startsWith("/agents/")) {
      keys.set("agent", path);
      return keys;
    }
    const cut = path.indexOf("/", 1);
    const page = cut < 0 ? path.slice(1) : path.slice(1, cut);
    keys.set("page", page);
    if (page === "contexts" && cut > 0 && !keys.has("context"))
      keys.set("context", path.slice(cut));
    return keys;
  },
  hrefOf(given) {
    const keys = new URLSearchParams(given);
    const agent = keys.get("agent");
    const page = keys.get("page");
    const context = keys.get("context");
    let pathname = "/";
    if (agent) {
      // the Agents page's, whatever page is named
      if (agent.startsWith("/agents/") && sayable(agent)) {
        pathname = urlPathOf(agent);
        keys.delete("agent");
        keys.delete("page");
      }
    } else if (page && PAGE_SEGMENT.test(page)) {
      pathname = `/${page}`;
      keys.delete("page");
      if (page === "contexts" && context && sayable(context)) {
        pathname += urlPathOf(context);
        keys.delete("context");
      }
    }
    const query = keys.toString().replaceAll("%2F", "/");
    return query ? `${pathname}?${query}` : pathname;
  },
};

// every part of the Dash imports this file, so the paths are named before the Dash draws
pathAddresses(dashPaths);
