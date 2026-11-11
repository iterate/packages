import type { IntegrationTarget } from "iterate/integrations";

/** A project's own site — its page at `routingSlug` (the apex when absent) and `path` (default
 *  "/") — on the project's domain: the apex is `https://<address>`, a routing slug its subdomain. */
export function projectSiteOf(
  project: string,
  page: { routingSlug?: string | null; path?: string } = {},
): string {
  const host = page.routingSlug ? `${page.routingSlug}.${project}` : project;
  return new URL(page.path || "/", `https://${host}`).href;
}

/** Where a button a project's package registered leads (iterate/integrations `IntegrationTarget`),
 *  as an href: an absolute http(s) URL as the package wrote it, else the project's own page at
 *  `routingSlug` and `path` (`projectSiteOf`). The page renders only targets the contract parsed,
 *  so the URL is http(s) and the path starts with one "/". */
export function integrationTargetHrefOf(project: string, target: IntegrationTarget): string {
  return "url" in target ? target.url : projectSiteOf(project, target);
}
