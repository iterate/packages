import { dashPaths } from "#/components/dash/dash-paths.ts";

/** The context a "Stream ↗" opens, in the mind's Dash at `dashOrigin`. */
export type StreamTarget = {
  /** `https://dash.<the mind's domain>`; null when the page knows no Dash */
  dashOrigin: string | null;
  platformOrigin: string;
  /** the mind's slug */
  mind: string;
  /** the context's path, `/` for the mind's root */
  path: string;
};

/** "Stream ↗": from a page to the context its data lives on, in the Contexts page of the mind's
 *  Dash (`/contexts/<path>` or `/contexts?contextPath=/` on `dashOrigin`): the context's events,
 *  its processors and their live state. The convention for a page that is one context's events (a
 *  doc, an agent): this one quiet link, beside the page's path. Nothing when the page knows no
 *  Dash. */
export function StreamLink(target: StreamTarget) {
  const href = streamHref(target);
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title={`${target.path}: its events and processors, in the Dash`}
      className="text-xs text-muted-foreground hover:text-foreground"
    >
      Stream ↗
    </a>
  );
}

/** Where "Stream ↗" goes: null when there is no Dash to go to. */
export function streamHref({ dashOrigin, path }: Pick<StreamTarget, "dashOrigin" | "path">) {
  if (!dashOrigin) return null;
  // the root too is named: the Contexts page with no `context` opens no context
  const origin = dashOrigin.replace(/\/+$/, "");
  return `${origin}${dashPaths.hrefOf(new URLSearchParams({ page: "contexts", context: path }))}`;
}
