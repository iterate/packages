import type { SyntheticEvent } from "react";

/** Where a context path links to, the app's: `hrefOf("/repos")` is its URL; `onNavigate`, when the
 *  app has a client router, takes a plain click or an Enter (it prevents the default and navigates).
 *  Without it a link is a page load. */
export type ContextPathLinks = {
  hrefOf: (path: string) => string;
  onNavigate?: (href: string, event: SyntheticEvent) => void;
};

/** Go to `path` as the app does it: its router, else a page load. */
export function navigateToPath(links: ContextPathLinks, path: string, event: SyntheticEvent) {
  const href = links.hrefOf(path);
  if (links.onNavigate) links.onNavigate(href, event);
  else window.location.assign(href);
}
