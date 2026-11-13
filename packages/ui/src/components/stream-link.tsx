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
 *  Dash (`?page=contexts&context=<path>` on `dashOrigin`): the context's events, its processors and
 *  their live state. The convention for a page that is one context's events (a doc, an agent): this
 *  one quiet link, beside the page's path. Nothing when the page knows no Dash. */
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
function streamHref({ dashOrigin, path }: StreamTarget) {
  if (!dashOrigin) return null;
  const query = new URLSearchParams({ page: "contexts", ...(path !== "/" && { context: path }) });
  return `${dashOrigin}/?${query}`;
}
