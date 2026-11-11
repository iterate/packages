import type { ReactNode } from "react";
import { useParams, useRouterState } from "@tanstack/react-router";
import type { Principal } from "iterate/principal";
import type { AppPaletteEntry } from "#/components/app-shell-palette-entries.ts";
import { AppShell } from "#/components/app-shell.tsx";
import { DefaultPendingComponent } from "#/components/route-defaults.tsx";

/** A project's page in an app that shows one project at a time (Notes, Voice): the shared
 *  `AppShell` with that project picked in its switcher, each project at `/projects/<address>` under
 *  the page's `basePath`. The switcher names the app and the project, so the header row adds
 *  nothing of its own: a desktop shows it only for a page's own row (`AppShellPageHeader`). */
export function ProjectAppShell({
  app,
  project,
  basePath = "",
  account,
  locationKey,
  nav,
  paletteEntries,
  children,
}: {
  app: string;
  /** the project's address */
  project: string;
  /** the path the page is served under when a project proxies the app (packages/ui/src/apps/base-path.ts) */
  basePath?: string;
  /** the person signed in, null when the app does not know; a placeholder until the session has
   *  answered (`ProjectAppFrame`) */
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
      project={project}
      projectHref={(address) => `${basePath}/projects/${address}`}
      nav={nav}
      paletteEntries={paletteEntries}
      account={account}
      locationKey={locationKey}
    >
      {children}
    </AppShell>
  );
}

/** A project's page before it has loaded, drawn from the URL alone: `ProjectAppShell` with the
 *  project by its address, a placeholder for the account and a spinner for the page. An app names
 *  it as the `pendingComponent` of its project route, so the frame is the page until the browser
 *  has signed in and while the route reads. A path without a project shows the spinner alone. */
export function ProjectAppFrame({ app, basePath }: { app: string; basePath?: string }) {
  const { project } = useParams({ strict: false });
  const locationKey = useRouterState({ select: (state) => state.location.href });
  if (!project) return <DefaultPendingComponent />;
  return (
    <ProjectAppShell app={app} project={project} basePath={basePath} locationKey={locationKey}>
      <DefaultPendingComponent />
    </ProjectAppShell>
  );
}
