import type { ReactNode } from "react";
import { Outlet, Scripts, useHydrated } from "@tanstack/react-router";
import { AppProviders } from "./providers.tsx";
import { EnvironmentHeadContent } from "#/components/environment-head-content.tsx";

/** Every app's root `shellComponent`: the document around whatever the root route shows, its
 *  pages, its error or its not-found page. It reads no loader data, so a root loader that fails
 *  still gets a document with the app's styles and scripts. `icon` is the app's icon file in
 *  production. `basePath` is the path the page is served under when a mind proxies it
 *  (packages/ui/src/apps/base-path.ts): the icon goes under it, and the browser's router reads it
 *  from `<html data-base-path>` before it starts. */
export function AppDocumentShell(props: { icon: string; basePath?: string; children: ReactNode }) {
  // false in the server's HTML, true once React owns the page: the specs' hydration-waiter
  // (test/playwright/AGENTS.md) holds actions until then
  const hydrated = useHydrated();
  const basePath = props.basePath || "";
  return (
    <html lang="en" data-base-path={basePath || undefined}>
      <head>
        <EnvironmentHeadContent productionIcon={`${basePath}${props.icon}`} />
      </head>
      <body className="min-h-svh bg-background font-sans antialiased" data-hydrated={hydrated}>
        {props.children}
        <Scripts />
      </body>
    </html>
  );
}

/** Every app's root route `component`, inside `AppDocumentShell`: the app's providers around its
 *  pages. */
export function AppRoot(props: { posthogProjectKey: string | null }) {
  return (
    <AppProviders posthogApiKey={props.posthogProjectKey || undefined}>
      <Outlet />
    </AppProviders>
  );
}

/** The document and the providers in one root `component`, for an app with no `shellComponent`. */
export function AppDocument(props: {
  icon: string;
  posthogProjectKey: string | null;
  basePath?: string;
}) {
  return (
    <AppDocumentShell icon={props.icon} basePath={props.basePath}>
      <AppRoot posthogProjectKey={props.posthogProjectKey} />
    </AppDocumentShell>
  );
}
