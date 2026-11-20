// Pure codec for the Dash's canonical client-side addresses (zero side effects, so non-Dash
// components such as StreamLink can format Dash links without registering path mode on page-url):
//
//   /                                            the first page (Home)
//   /secrets                                     the page with id `secrets`
//   /agents                                      the Agents overview
//   /agents/agents/onboarding                    the agent view of `/agents/onboarding` (`/agents?contextPath=/` for root)
//   /contexts/repos/config                       the raw view of `/repos/config` (`/contexts?contextPath=/` for root)
//   /repos/config/worker.ts                      one file of a repo (`/repos`, `/repos/docs` without a file)
//   /<id>/<rest>                                 any other page's own path remainder, passed as `rest`
//
// A context's path is never read from the root of the URL, so a page and a context cannot share an
// address: `/secrets` is the page, and the context `/secrets` is `/contexts/secrets`. Both Agents
// and Contexts use one shared rule (`contextRouteOf` / `readContextRoute`) to place a context path
// after their own segment, falling back to `?contextPath=` only for paths a URL pathname cannot
// round-trip (`/`, `.`, `..`, empty segments, or a relative path).
import { z } from "zod";
import type { PathAddresses } from "#/lib/page-url.ts";

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

/** Writes a context path after `/<page>`: sayable non-root paths go in the pathname, and root `/`
 *  or unsayable paths stay in `?contextPath=`. Shared by Agents and Contexts. */
function contextRouteOf(page: string, path: string): { pathname: string; contextPath?: string } {
  if (sayable(path)) return { pathname: `/${page}${urlPathOf(path)}` };
  return { pathname: `/${page}`, contextPath: path };
}

/** Reads a context path from `/<page>/<tail…>` or `/<page>?contextPath=<unsayable>`. Shared by
 *  Agents and Contexts. */
function readContextRoute(tail: string[], keys: URLSearchParams): string | undefined {
  const contextPath = keys.get("contextPath");
  keys.delete("contextPath");
  if (contextPath && !sayable(contextPath)) return contextPath;
  if (tail.length > 0) return `/${tail.join("/")}`;
  return undefined;
}

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
    // 1. Agents: `/agents/<path>` or `/agents?contextPath=<path>` (no separate page remainder).
    if (page === "agents") {
      const target = readContextRoute(tail, keys);
      if (target) {
        keys.set("agent", target);
        return keys;
      }
      keys.set("page", "agents");
      return keys;
    }
    // 2. Contexts: `/contexts/<path>`, or `/contexts?contextPath=<path>` for root / unsayable.
    if (page === "contexts") {
      keys.set("page", "contexts");
      const target = readContextRoute(tail, keys);
      if (target) keys.set("context", target);
      return keys;
    }
    // 3. Repos: `/repos/<repo>/<file…>` merges `<file…>` into the `view` JSON.
    if (page === "repos") {
      keys.set("page", "repos");
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
      // 1. Agents: sayable non-root paths go in `/agents/<path>`; root/unsayable in `contextPath`.
      const route = contextRouteOf("agents", agent);
      pathname = route.pathname;
      contextPath = route.contextPath;
      keys.delete("agent");
      keys.delete("page");
      keys.delete("contextPath");
    } else if (page && PAGE_SEGMENT.test(page)) {
      pathname = `/${page}`;
      keys.delete("page");
      if (page === "contexts") {
        // 2. Contexts: same context-path rule as Agents.
        const context = keys.get("context");
        if (context) {
          keys.delete("context");
          keys.delete("contextPath");
          const route = contextRouteOf("contexts", context);
          pathname = route.pathname;
          contextPath = route.contextPath;
        }
      } else if (page === "repos") {
        // 3. Repos: `/repos/<repo>/<file>` when sayable; otherwise keep unsayable values in query.
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
      } else if (page !== "agents") {
        // 4. Any other page (not `/agents`): preserve a sayable `rest` in the pathname.
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
