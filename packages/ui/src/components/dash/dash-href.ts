// The Dash's client-side addresses:
//
//   /                                            the first page
//   /secrets                                     the page with id `secrets`
//   /agents?contextPath=/agents/onboarding       the agent view of any context path
//   /contexts/repos/config                       the raw view of `/repos/config` (`/contexts?contextPath=/` for root)
//   /repo/config/worker.ts                       one file of a repo (`/repo`, `/repo/docs` without a file)
//   /<id>/<rest>                                 any page's own path remainder, passed as `rest`
//
// A context's path is never read from the root of the URL, so a page and a context cannot share an
// address: `/secrets` is the page, and the context `/secrets` is `/contexts/secrets`. Values that
// a URL path cannot round-trip (`.`, `..`, empty segments, or a reserved first segment) stay in
// the query.
import { z } from "zod";
import { pageHref, pathAddresses, type PathAddresses } from "#/lib/page-url.ts";

/** The agent view of `path`, from any page. */
export function agentViewHref(path: string) {
  return pageHref(undefined, { agent: path });
}

/** The raw view of `path` on the page `page` (the Dash's Contexts page): `/` too is named, as a
 *  page with no context opens no context. */
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

/** Decoded non-empty segments of a URL's pathname; a malformed escape stays as written. */
function pathSegmentsOf(pathname: string): string[] {
  return pathname.split("/").filter(Boolean).map(decoded);
}

function decoded(segment: string) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** A path that a URL's path can say and `pathSegmentsOf` reads back: from the root, with no empty,
 *  `.` or `..` segment (a browser resolves those away), and not the root itself. */
const sayable = (path: string) =>
  path.length > 1 &&
  path.startsWith("/") &&
  path
    .slice(1)
    .split("/")
    .every((segment) => segment && segment !== "." && segment !== "..");

/** A single path segment that round-trips without splitting or dot-segment resolution. */
const sayableSegment = (segment: string) =>
  Boolean(segment) && !segment.includes("/") && segment !== "." && segment !== "..";

/** A relative multi-segment path (a repo file or a page's remainder) that round-trips. */
const sayableRelative = (path: string) => !path.startsWith("/") && sayable(`/${path}`);

/** A page id that can be the first segment: a plain word that is no path of the Dash's own host
 *  (`/itx`, `/connect`, `/api`, `/keys`, `/brands`; a file's name has a dot, and `/.auth/`,
 *  `/.iterate/` and `/.well-known/` start with one). */
const PAGE_SEGMENT = /^(?!(?:itx|connect|api|keys|brands)$)[A-Za-z0-9][A-Za-z0-9_-]*$/;

const ViewObject = z.record(z.string(), z.unknown());

/** Parses `?view=<json>` into a plain object, or null when absent or not a JSON object. */
function viewObjectOf(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    return ViewObject.safeParse(JSON.parse(raw)).data || null;
  } catch {
    return null;
  }
}

/** Query string with `/ @ : ,` kept raw and spaces written as `%20` (a literal `+` is `%2B`). */
function formatQuery(keys: URLSearchParams, contextPath?: string): string {
  const ordered = new URLSearchParams();
  if (contextPath) ordered.set("contextPath", contextPath);
  for (const [key, value] of keys) ordered.append(key, value);
  return ordered
    .toString()
    .replaceAll("+", "%20")
    .replace(/%(?:2F|40|3A|2C)/g, decodeURIComponent);
}

/** Trailing `.` `,` `:` encoded so Slack and mail linkifiers do not drop them from the link. */
const TRAILING_PUNCTUATION: Record<string, string> = { ".": "%2E", ",": "%2C", ":": "%3A" };

export const dashPaths: PathAddresses = {
  keysOf(pathname, search) {
    const keys = new URLSearchParams(search);
    const rawPage = keys.get("page");
    const rawRepo = keys.get("repo");
    // Internal route keys come from the pathname, never from legacy query params.
    keys.delete("page");
    keys.delete("agent");
    keys.delete("context");
    if (rawRepo && sayableSegment(rawRepo)) keys.delete("repo");
    const segments = pathSegmentsOf(pathname);
    if (!segments.length) {
      // Reserved or non-segment page ids cannot live in the first path segment.
      if (rawPage && !PAGE_SEGMENT.test(rawPage)) keys.set("page", rawPage);
      return keys;
    }
    const [page, ...tail] = segments;
    // 1. Agents: `/agents?contextPath=<path>` opens that agent; `/agents/<rest>` passes `rest`.
    if (page === "agents") {
      const contextPath = keys.get("contextPath");
      if (contextPath && tail.length === 0) {
        keys.set("agent", contextPath);
        keys.delete("contextPath");
        return keys;
      }
      keys.set("page", "agents");
      if (tail.length > 0 && !keys.has("rest")) keys.set("rest", tail.join("/"));
      return keys;
    }
    // 2. Contexts: `/contexts/<path>`, or `/contexts?contextPath=<path>` for root / unsayable.
    if (page === "contexts") {
      keys.set("page", "contexts");
      const contextPath = keys.get("contextPath");
      if (contextPath) {
        keys.set("context", contextPath);
        keys.delete("contextPath");
      } else if (tail.length > 0) {
        keys.set("context", `/${tail.join("/")}`);
      }
      return keys;
    }
    // 3. Repo: `/repo/<repo>/<file…>` merges `<file…>` into the `view` JSON.
    if (page === "repo") {
      keys.set("page", "repo");
      if (tail.length >= 1) {
        keys.set("repo", tail[0]!);
        if (tail.length >= 2) {
          const view = viewObjectOf(keys.get("view")) || {};
          keys.set("view", JSON.stringify({ ...view, file: tail.slice(1).join("/") }));
        }
      }
      return keys;
    }
    // 4. Any other page: `/<id>` with an optional remainder passed through as `rest`.
    keys.set("page", page!);
    if (tail.length > 0 && !keys.has("rest")) keys.set("rest", tail.join("/"));
    return keys;
  },
  hrefOf(given) {
    const keys = new URLSearchParams(given);
    const page = keys.get("page");
    const agent = keys.get("agent");
    let pathname = "/";
    let contextPath: string | undefined;
    if (agent) {
      // 1. Agents: any context path goes in `contextPath`, written first in the query.
      pathname = "/agents";
      contextPath = agent;
      keys.delete("agent");
      keys.delete("page");
      keys.delete("contextPath");
    } else if (page && PAGE_SEGMENT.test(page)) {
      pathname = `/${page}`;
      keys.delete("page");
      if (page === "contexts") {
        // 2. Contexts: sayable non-root paths go in the pathname; root and unsayable in `contextPath`.
        const context = keys.get("context");
        if (context) {
          keys.delete("context");
          keys.delete("contextPath");
          if (sayable(context)) pathname += urlPathOf(context);
          else contextPath = context;
        }
      } else if (page === "repo") {
        // 3. Repo: `/repo/<repo>/<file>` when sayable; otherwise keep unsayable values in query.
        const repo = keys.get("repo");
        const view = viewObjectOf(keys.get("view"));
        const file = view && typeof view.file === "string" ? view.file : undefined;
        const targetRepo = repo || "config";
        if (file && sayableRelative(file) && sayableSegment(targetRepo)) {
          pathname += `${urlPathOf(`/${targetRepo}`)}${urlPathOf(`/${file}`)}`;
          keys.delete("repo");
          const { file: _lifted, ...restView } = view!;
          if (Object.keys(restView).length > 0) keys.set("view", JSON.stringify(restView));
          else keys.delete("view");
        } else if (repo && sayableSegment(repo)) {
          pathname += urlPathOf(`/${repo}`);
          keys.delete("repo");
        }
      } else {
        // 4. Any other page (and `/agents/<rest>`): preserve a sayable `rest` in the pathname.
        const rest = keys.get("rest");
        if (rest && sayableRelative(rest)) {
          pathname += urlPathOf(`/${rest}`);
          keys.delete("rest");
        }
      }
    }
    const query = formatQuery(keys, contextPath);
    const href = query ? `${pathname}?${query}` : pathname;
    return href.replace(/[.,:]$/, (char) => TRAILING_PUNCTUATION[char]!);
  },
};

// every part of the Dash imports this file, so the paths are named before the Dash draws
pathAddresses(dashPaths);
