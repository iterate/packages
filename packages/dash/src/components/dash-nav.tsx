// The dash's own navigation inside the shared shell (`AppShell`, packages/ui): inside a project its
// overview, contexts (any context's log, live), repos (the repo IDE), MCP, secrets and its site; outside one the account's pages, THE TREE — the person's
// organizations, each with its projects (components/organization-tree.tsx) — and the other
// first-party apps.
import { getRouteApi, Link, useMatchRoute } from "@tanstack/react-router";
import {
  Activity,
  Blocks,
  Building2,
  ChartLine,
  ExternalLink,
  FolderGit2,
  FolderKanban,
  Globe,
  KeyRound,
  LayoutDashboard,
  LockKeyhole,
  Plug,
  Waypoints,
} from "lucide-react";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@iterate-com/ui/components/ui/sidebar";
import { SidebarRowSkeleton } from "@iterate-com/ui/components/app-shell";
import { appHrefOf } from "../lib/origins.ts";
import { useOrganizationTree } from "./organization-tree.tsx";

/** The root loader's: the directory of apps this deployment has (apps.ts `appDirectory`). */
const root = getRouteApi("__root__");

const PROJECT_PAGES = [
  { to: "/projects/$slug", label: "Overview", icon: LayoutDashboard },
  { to: "/projects/$slug/contexts/$", label: "Contexts", icon: Waypoints },
  { to: "/projects/$slug/repos", label: "Repos", icon: FolderGit2 },
  { to: "/projects/$slug/analytics", label: "Analytics", icon: ChartLine },
  { to: "/projects/$slug/mcp", label: "MCP", icon: Plug },
  { to: "/projects/$slug/secrets", label: "Secrets", icon: LockKeyhole },
  { to: "/projects/$slug/integrations", label: "Integrations", icon: Blocks },
  { to: "/projects/$slug/domains", label: "Domains", icon: Globe },
] as const;

const ACCOUNT_PAGES = [
  { to: "/projects", label: "Projects", icon: FolderKanban },
  { to: "/organizations", label: "Organizations", icon: Building2 },
  { to: "/sessions", label: "Sessions", icon: KeyRound },
  { to: "/activity", label: "Activity", icon: Activity },
] as const;

/** Inside a project: its overview, how to connect over MCP, its secrets, its own site, and the first-party apps
 *  opened on it — every app
 *  serves `/projects/<slug>`, so the links are the convention, and a signed-out click proves the
 *  apps' OAuth returns to the deep link. */
export function ProjectNav({
  project,
  host,
  platformOrigin,
  signingIn,
}: {
  project: { slug: string };
  /** the project's own site; null when this deployment serves none */
  host: string | null;
  /** the platform the dash is signed in to (`info().platformOrigin`): the app links connect to it
   *  (origins.ts `appHrefOf`); unknown before sign-in */
  platformOrigin?: string;
  /** before sign-in (the shell's frame, routes/_auth.tsx) the site is not known yet: a placeholder
   *  holds its row */
  signingIn?: boolean;
}) {
  const matchRoute = useMatchRoute();
  const { apps } = root.useLoaderData();
  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <SidebarMenu>
          {PROJECT_PAGES.map(({ to, label, icon: Icon }) => (
            <SidebarMenuItem key={to}>
              <SidebarMenuButton
                tooltip={label}
                // Contexts and Repos are splats (`/contexts/<any context path>`, `/repos/<name>`):
                // active on every path under them; the others only on their own page, so Overview
                // is not lit everywhere
                isActive={Boolean(
                  matchRoute({
                    to,
                    params: { slug: project.slug },
                    fuzzy: to === "/projects/$slug/contexts/$" || to === "/projects/$slug/repos",
                  }),
                )}
                render={<Link to={to} params={{ slug: project.slug }} />}
              >
                <Icon />
                <span>{label}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
          {signingIn ? (
            <SidebarMenuItem>
              <SidebarRowSkeleton />
            </SidebarMenuItem>
          ) : null}
          {host ? (
            <SidebarMenuItem>
              <SidebarMenuButton
                tooltip={new URL(host).host}
                render={
                  <a
                    href={host}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Open ${new URL(host).host}`}
                  />
                }
              >
                <ExternalLink />
                <span>Project site</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ) : null}
          {apps.map((app) => (
            <SidebarMenuItem key={app.url}>
              <SidebarMenuButton
                tooltip={`${app.name} for ${project.slug}`}
                render={
                  <a
                    href={appHrefOf(app.url, platformOrigin, `/projects/${project.slug}`)}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`${app.name} for ${project.slug}`}
                  />
                }
              >
                <ExternalLink />
                <span>{app.name}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

/** Outside a project: the projects and organizations lists, the account pages; the tree — every
 *  organization the person belongs to, its projects under it; and the other first-party apps, on
 *  the platform the dash is signed in to (as `ProjectNav`'s). */
export function TopLevelNav({ platformOrigin }: { platformOrigin?: string }) {
  const matchRoute = useMatchRoute();
  const { apps } = root.useLoaderData();
  return (
    <>
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu>
            {ACCOUNT_PAGES.map(({ to, label, icon: Icon }) => (
              <SidebarMenuItem key={to}>
                <SidebarMenuButton
                  tooltip={label}
                  isActive={Boolean(matchRoute({ to, fuzzy: false }))}
                  render={<Link to={to} />}
                >
                  <Icon />
                  <span>{label}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
      <OrganizationTreeNav />
      {apps.length ? (
        <SidebarGroup>
          <SidebarGroupLabel>Apps</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {apps.map((app) => (
                <SidebarMenuItem key={app.url}>
                  <SidebarMenuButton
                    tooltip={app.name}
                    render={
                      <a
                        href={appHrefOf(app.url, platformOrigin, "/")}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={app.name}
                      />
                    }
                  >
                    <ExternalLink />
                    <span>{app.name}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ) : null}
    </>
  );
}

/** The tree: each organization the person belongs to (→ its settings), its projects under it
 *  (→ each overview). Skeleton rows until the tree's first read answers. */
function OrganizationTreeNav() {
  const tree = useOrganizationTree();
  const matchRoute = useMatchRoute();
  return (
    <SidebarGroup>
      <SidebarGroupLabel>Your organizations</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {!tree.loaded && !tree.organizations.length ? (
            <SidebarMenuItem>
              <SidebarRowSkeleton />
            </SidebarMenuItem>
          ) : null}
          {tree.error ? (
            <SidebarMenuItem data-type="error" className="px-2 text-xs text-destructive">
              {tree.error}
            </SidebarMenuItem>
          ) : null}
          {tree.loaded && !tree.organizations.length && !tree.error ? (
            <SidebarMenuItem className="px-2 text-xs text-muted-foreground">
              No organizations yet
            </SidebarMenuItem>
          ) : null}
          {tree.organizations.map((org) => (
            <SidebarMenuItem key={org.id}>
              <SidebarMenuButton
                tooltip={org.name}
                isActive={Boolean(
                  matchRoute({
                    to: "/organizations/$orgId",
                    params: { orgId: org.id },
                    fuzzy: true,
                  }),
                )}
                render={<Link to="/organizations/$orgId" params={{ orgId: org.id }} />}
              >
                <Building2 />
                <span>{org.name}</span>
              </SidebarMenuButton>
              {org.projects.length ? (
                <SidebarMenuSub>
                  {org.projects.map((project) => (
                    <SidebarMenuSubItem key={project.id}>
                      <SidebarMenuSubButton
                        isActive={Boolean(
                          matchRoute({
                            to: "/projects/$slug",
                            params: { slug: project.slug },
                            fuzzy: true,
                          }),
                        )}
                        className="font-mono"
                        render={<Link to="/projects/$slug" params={{ slug: project.slug }} />}
                      >
                        <span>{project.slug}</span>
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                  ))}
                </SidebarMenuSub>
              ) : null}
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
