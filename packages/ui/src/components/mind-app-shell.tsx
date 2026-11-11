import type { ReactNode } from "react";
import { useParams, useRouterState } from "@tanstack/react-router";
import type { Principal } from "iterate/principal";
import type { AppPaletteEntry } from "#/components/app-shell-palette-entries.ts";
import { AppShell } from "#/components/app-shell.tsx";
import { DefaultPendingComponent } from "#/components/route-defaults.tsx";

/** A mind's page in an app that shows one mind at a time (Notes, Voice): the shared
 *  `AppShell` with that mind picked in its switcher, each mind at `/minds/<address>` under
 *  the page's `basePath`. The switcher names the app and the mind, so the header row adds
 *  nothing of its own: a desktop shows it only for a page's own row (`AppShellPageHeader`). */
export function MindAppShell({
  app,
  mind,
  basePath = "",
  account,
  locationKey,
  nav,
  paletteEntries,
  children,
}: {
  app: string;
  /** the mind's address */
  mind: string;
  /** the path the page is served under when a mind proxies the app (packages/ui/src/apps/base-path.ts) */
  basePath?: string;
  /** the person signed in, null when the app does not know; a placeholder until the session has
   *  answered (`MindAppFrame`) */
  account?: Principal | null;
  /** the router's current href — a change closes the phone's sidebar sheet */
  locationKey: string;
  /** the app's own navigation in the sidebar, its `SidebarGroup`s (`AppShell`'s `nav`, which ⌘K
   *  lists too) */
  nav?: ReactNode;
  /** rows for ⌘K the app hands over (`AppShell`'s `paletteEntries`) */
  paletteEntries?: AppPaletteEntry[];
  children: ReactNode;
}) {
  return (
    <AppShell
      app={app}
      mind={mind}
      mindHref={(address) => `${basePath}/minds/${address}`}
      nav={nav}
      paletteEntries={paletteEntries}
      account={account}
      locationKey={locationKey}
    >
      {children}
    </AppShell>
  );
}

/** A mind's page before it has loaded, drawn from the URL alone: `MindAppShell` with the
 *  mind by its address, a placeholder for the account and a spinner for the page. An app names
 *  it as the `pendingComponent` of its mind route, so the frame is the page until the browser
 *  has signed in and while the route reads. A path without a mind shows the spinner alone. */
export function MindAppFrame({ app, basePath }: { app: string; basePath?: string }) {
  const { mind } = useParams({ strict: false });
  const locationKey = useRouterState({ select: (state) => state.location.href });
  if (!mind) return <DefaultPendingComponent />;
  return (
    <MindAppShell app={app} mind={mind} basePath={basePath} locationKey={locationKey}>
      <DefaultPendingComponent />
    </MindAppShell>
  );
}
