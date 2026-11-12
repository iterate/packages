import type { IntegrationTarget } from "iterate/integrations";

/** A mind's own site — its page at `routingSlug` (the apex when absent) and `path` (default
 *  "/") — on the mind's domain: the apex is `https://<address>`, a routing slug its subdomain. */
export function mindSiteOf(
  mind: string,
  page: { routingSlug?: string | null; path?: string } = {},
): string {
  const host = page.routingSlug ? `${page.routingSlug}.${mind}` : mind;
  return new URL(page.path || "/", `https://${host}`).href;
}

/** Where a button a mind's package registered leads (iterate/integrations `IntegrationTarget`),
 *  as an href: an absolute http(s) URL as the package wrote it, else the mind's own page at
 *  `routingSlug` and `path` (`mindSiteOf`). The page renders only targets the contract parsed,
 *  so the URL is http(s) and the path starts with one "/". */
export function integrationTargetHrefOf(mind: string, target: IntegrationTarget): string {
  return "url" in target ? target.url : mindSiteOf(mind, target);
}
