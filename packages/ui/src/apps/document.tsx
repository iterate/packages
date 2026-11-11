import { Outlet, Scripts, useHydrated } from "@tanstack/react-router";
import { AppProviders } from "./providers.tsx";
import { EnvironmentHeadContent } from "#/components/environment-head-content.tsx";

/** Every app's root route component: the document, with the app's providers around its pages.
 *  `icon` is the app's icon file in production. `basePath` is the path the page is served under
 *  when a mind proxies it (packages/ui/src/apps/base-path.ts): the icon goes under it, and the browser's
 *  router reads it from `<html data-base-path>` before it starts. */
export function AppDocument(props: {
  icon: string;
  posthogProjectKey: string | null;
  basePath?: string;
}) {
  // false in the server's HTML, true once React owns the page: the specs' hydration-waiter
  // (test/playwright/AGENTS.md) holds actions until then
  const hydrated = useHydrated();
  const basePath = props.basePath || "";
  return (
    // The theme's class is on <html> before React hydrates (next-themes's own script puts it
    // there), so the server's markup, which has none, must not be held against it.
    <html lang="en" data-base-path={basePath || undefined} suppressHydrationWarning>
      <head>
        <EnvironmentHeadContent productionIcon={`${basePath}${props.icon}`} />
      </head>
      <body className="min-h-svh bg-background font-sans antialiased" data-hydrated={hydrated}>
        <AppProviders posthogApiKey={props.posthogProjectKey || undefined}>
          <Outlet />
        </AppProviders>
        <Scripts />
      </body>
    </html>
  );
}
