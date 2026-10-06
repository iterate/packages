import type { ReactNode } from "react";
import { useParams, useRouterState } from "@tanstack/react-router";
import type { Principal } from "iterate/principal";
import type { AppPaletteEntry } from "#/components/app-shell-palette-entries.ts";
import { AppShell, type AppShellProject } from "#/components/app-shell.tsx";
import { DefaultPendingComponent } from "#/components/route-defaults.tsx";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "#/components/ui/breadcrumb.tsx";

/** A project's page in an app that shows one project at a time (Notes, Voice): the shared
 *  `AppShell` with that project picked in its switcher, each project at `/projects/<slug>` under
 *  the page's `basePath`, and `<app> › <slug>` in the header. */
export function ProjectAppShell({
  app,
  projects,
  project,
  basePath = "",
  account,
  locationKey,
  nav,
  paletteEntries,
  children,
}: {
  app: string;
  projects: AppShellProject[];
  project: AppShellProject;
  /** the path the page is served under when a project proxies the app (packages/ui/src/apps/base-path.ts) */
  basePath?: string;
  /** the person signed in; a placeholder until the session has answered (`ProjectAppFrame`) */
  account?: Principal;
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
      projects={projects}
      activeProjectId={project.id}
      projectHref={(item) => `${basePath}/projects/${item.slug}`}
      header={
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem className="hidden md:inline-flex">{app}</BreadcrumbItem>
            <BreadcrumbSeparator className="hidden md:inline-flex" />
            <BreadcrumbItem>
              <BreadcrumbPage className="font-mono">{project.slug}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      }
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
 *  project by its slug, a placeholder for the account and a spinner for the page. An app names it
 *  as the `pendingComponent` of its `_auth` route, whose `ssr: false` makes it the server's HTML
 *  and the page until the browser has signed in, and of its project route, so the frame stays
 *  while that route reads. A path without a project shows the spinner alone. */
export function ProjectAppFrame({ app, basePath }: { app: string; basePath?: string }) {
  const { slug } = useParams({ strict: false });
  const locationKey = useRouterState({ select: (state) => state.location.href });
  if (!slug) return <DefaultPendingComponent />;
  const project = { id: slug, slug };
  return (
    <ProjectAppShell
      app={app}
      projects={[project]}
      project={project}
      basePath={basePath}
      locationKey={locationKey}
    >
      <DefaultPendingComponent />
    </ProjectAppShell>
  );
}
