import type { ReactNode } from "react";
import { useParams, useRouterState } from "@tanstack/react-router";
import type { Principal } from "iterate/principal";
import type { AppPaletteEntry } from "#/components/app-shell-palette-entries.ts";
import { AppShell } from "#/components/app-shell.tsx";
import { DefaultErrorComponent, DefaultPendingComponent } from "#/components/route-defaults.tsx";

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
 *  has signed in and while the route reads. A path without a mind shows the spinner alone.
 *  `children` take the spinner's place (`MindAppLoadError`). */
export function MindAppFrame({
  app,
  basePath,
  children,
}: {
  app: string;
  basePath?: string;
  children?: ReactNode;
}) {
  const { mind } = useParams({ strict: false });
  const locationKey = useRouterState({ select: (state) => state.location.href });
  const body = children || <DefaultPendingComponent />;
  if (!mind) return body;
  return (
    <MindAppShell app={app} mind={mind} basePath={basePath} locationKey={locationKey}>
      {body}
    </MindAppShell>
  );
}

/** A mind's page whose sign-in or first read failed: the frame stays, so the person can still go
 *  to another mind, and the page says which mind and what failed, with a retry. An app names it as
 *  the `errorComponent` of its mind route. */
export function MindAppLoadError({
  app,
  basePath,
  error,
}: {
  app: string;
  basePath?: string;
  error: unknown;
}) {
  const { mind } = useParams({ strict: false });
  return (
    <MindAppFrame app={app} basePath={basePath}>
      <DefaultErrorComponent error={error} title={`${app} could not load ${mind || "this mind"}`} />
    </MindAppFrame>
  );
}
