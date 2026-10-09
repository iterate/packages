import type { IntegrationTarget } from "iterate/integrations";
import {
  pinnedHostnameOf,
  projectPublicUrlOf,
  projectUrlOf,
  type IngressRouting,
} from "iterate/project-ingress";

/** `value` as an http(s) origin, or null. What the issuer's `info()` reports — its platform and MCP
 *  origins — becomes an href or a copyable command only once parsed: a value that is not a URL, or
 *  not http(s) (`javascript:`), goes nowhere. */
export function httpOriginOf(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
}

/** A first-party app's page `next` (apps.ts), through the app's `/.auth/connect` for the platform
 *  the dash is signed in to, as Agents' link to the config repo goes: straight through for the app's
 *  own issuer, a confirmation for another, so a self-hosted platform's person lands on their own
 *  platform, not the app's default. A plain link when that origin is unknown (before sign-in) or not
 *  http(s). */
export function appHrefOf(
  appUrl: string,
  platformOrigin: string | undefined,
  next: string,
): string {
  const issuer = platformOrigin ? httpOriginOf(platformOrigin) : null;
  return issuer
    ? `${appUrl}/.auth/connect?${new URLSearchParams({ issuer, next })}`
    : `${appUrl}${next}`;
}

/** A project's default site under this deployment's ingress (`projectUrlOf`), whatever its primary
 *  hostname (that is `projectSiteOf`) — null when the deployment serves no project hosts. The slug,
 *  never the id: the id is how a project is addressed, the slug is its label in a hostname or a
 *  path. The platform's origin is parsed first: it comes from the issuer's `info()`, and only an
 *  http(s) origin may become an href. */
export function projectHostOf(
  info: { platformOrigin: string; ingressRouting: IngressRouting },
  slug: string,
): string | null {
  const origin = httpOriginOf(info.platformOrigin);
  return origin ? projectUrlOf(info.ingressRouting, origin, { project: slug })?.href || null : null;
}

/** A project's own site — its page at `routingSlug` (the apex when absent) and `path` (default "/")
 *  — as an href, composed as `itx.url` and `itx.whoami().projectUrl` compose it
 *  (`projectPublicUrlOf`): on the project's primary hostname when it has one, the one this
 *  deployment's config pins to it first, then the one it claimed, else under this deployment's
 *  ingress. Null when the deployment serves no project hosts or the platform's origin is not
 *  http(s). */
export function projectSiteOf(
  info: {
    platformOrigin: string;
    ingressRouting: IngressRouting;
    projectHostnames: readonly { hostname: string; project: string }[];
  },
  project: { id: string; slug: string; primaryHostname: string | null },
  page: { routingSlug?: string | null; path?: string } = {},
): string | null {
  const origin = httpOriginOf(info.platformOrigin);
  if (!origin) return null;
  return (
    projectPublicUrlOf(info.ingressRouting, origin, {
      project: project.slug,
      primaryHostname: pinnedHostnameOf(info.projectHostnames, project) ?? project.primaryHostname,
      routingSlug: page.routingSlug,
      path: page.path,
    })?.href || null
  );
}

/** Where a button a project's package registered leads (iterate/integrations `IntegrationTarget`),
 *  as an href, or null for no link: an absolute http(s) URL as the package wrote it, else the
 *  project's own page at `routingSlug` and `path` (`projectSiteOf`). The page renders only targets
 *  the contract parsed, so the URL is http(s) and the path starts with one "/". */
export function integrationTargetHrefOf(
  info: {
    platformOrigin: string;
    ingressRouting: IngressRouting;
    projectHostnames: readonly { hostname: string; project: string }[];
  },
  project: { id: string; slug: string; primaryHostname: string | null },
  target: IntegrationTarget,
): string | null {
  return "url" in target ? target.url : projectSiteOf(info, project, target);
}

/** The issuer's link that adds a GitHub sign-in to this session's person (core/os identity.ts,
 *  "ADD A SIGN-IN"), which the issuer follows only while it is signed in as them too: it lands back
 *  on `next`, with `?error=` when refused. Null when the platform's origin is not an http(s) one. */
export function addGithubSignInHref(
  info: { platformOrigin: string; principal: { actor: string } },
  next: string,
): string | null {
  const origin = httpOriginOf(info.platformOrigin);
  const query = new URLSearchParams({ link: info.principal.actor, next });
  return origin && `${origin}/.auth/identity/github?${query}`;
}
