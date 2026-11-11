// server.ts — EVERY APP'S WORKER (dash, agents, notes, voice, admin): its src/server.ts, Start's
// server entry, is `appServerEntry(handler, { … })` with only what the app does differently.
import { env } from "cloudflare:workers";
import { proxyPosthogRequest } from "@iterate-com/shared/posthog";
import { startAppConfigOf, type StartAppConfig } from "@iterate-com/shared/start-app-config";
import { appAuth } from "iterate/app-server";
import type { BrowserSession } from "iterate/app-session";

declare global {
  namespace Cloudflare {
    /** The bindings every app's Worker config gives it (startAppWorkerConfig, scripts/lib/start-app.ts). */
    interface Env {
      ASSETS: Fetcher;
      BROWSER_SESSION: DurableObjectNamespace<BrowserSession>;
      /** THE APP'S CONFIGURATION, JSON (@iterate-com/shared/start-app-config): its platform, the
       *  other apps' origins, our own zones and its PostHog key — from envs.ts (startAppWorkerConfig) */
      ITERATE_APP: string;
    }
  }
}

type AppServer = {
  /** The app's own routes ahead of the sign-in gate; null passes the request on. */
  before?: (request: Request, config: StartAppConfig) => Promise<Response | null>;
} & (
  | {
      proxied?: false;
      /** The name an issuer's consent page shows (`/.auth/client.json`, beside
       *  `/client-logo.svg`). Without one the gate names the app by its host. */
      clientName?: string;
    }
  | {
      /** Served only under a project's hosts, which a config worker fetches it through to (Notes):
       *  the platform answers those hosts' `/.auth/*` and `/api` itself (core/os/src/worker.ts), so
       *  the app has no sign-in gate and no OAuth client of its own. */
      proxied: true;
    }
);

/** The app's own origin signs a person in to each project they connect it to (`appAuth`) and
 *  proxies the authenticated `/api?project=<address>`. A `proxied` app skips that gate.
 *  Everything else is TanStack Start's: the built assets, then `pages`. */
export function appServerEntry(
  pages: { fetch(request: Request): Promise<Response> | Response },
  app: AppServer,
) {
  return {
    async fetch(request: Request) {
      // parsed on the first request, /healthz's included: a malformed config fails the deploy's smoke
      const config = startAppConfigOf(env);
      const url = new URL(request.url);
      if (url.pathname === "/healthz") return new Response("ok");
      // posthog-js's `api_host` (packages/ui posthog.tsx): PostHog EU through our own origin
      if (url.pathname.startsWith("/e/"))
        return proxyPosthogRequest({ request, proxyPrefix: "/e" });
      const own = await app.before?.(request, config);
      if (own) return own;
      if (!app.proxied) {
        const auth = await appAuth(request, {
          client: app.clientName
            ? { name: app.clientName, logoUri: "/client-logo.svg" }
            : undefined,
          sessions: env.BROWSER_SESSION,
        });
        if (auth) return auth;
      }
      const asset = await env.ASSETS.fetch(request);
      if (asset.status !== 404) return asset;
      return pages.fetch(request);
    },
  };
}
