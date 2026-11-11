// The dash's own navigation inside the shared shell (`AppShell`, packages/ui): the project's
// overview, contexts (any context's log, live), repos (the repo IDE), analytics, MCP, secrets, the
// requests that wait for approval, integrations, its site, and the other first-party apps this
// deployment names, opened on it.
import { getRouteApi, Link, useMatchRoute } from "@tanstack/react-router";
import {
  Blocks,
  ChartLine,
  ExternalLink,
  FolderGit2,
  LayoutDashboard,
  LockKeyhole,
  Plug,
  ShieldCheck,
  Waypoints,
} from "lucide-react";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@iterate-com/ui/components/ui/sidebar";
import { projectSiteOf } from "../lib/origins.ts";

/** The root loader's: the directory of apps this deployment has (apps.ts `appDirectory`), empty for
 *  a standalone Dash. */
const root = getRouteApi("__root__");

const PROJECT_PAGES = [
  { to: "/projects/$project", label: "Overview", icon: LayoutDashboard },
  { to: "/projects/$project/contexts/$", label: "Contexts", icon: Waypoints },
  { to: "/projects/$project/repos", label: "Repos", icon: FolderGit2 },
  { to: "/projects/$project/analytics", label: "Analytics", icon: ChartLine },
  { to: "/projects/$project/mcp", label: "MCP", icon: Plug },
  { to: "/projects/$project/secrets", label: "Secrets", icon: LockKeyhole },
  { to: "/projects/$project/approvals", label: "Approvals", icon: ShieldCheck },
  { to: "/projects/$project/integrations", label: "Integrations", icon: Blocks },
] as const;

/** The project's pages, its own site, and the first-party apps opened on it: every app serves
 *  `/projects/<address>`, and its own gate signs the browser in to the project there. */
export function ProjectNav({ project }: { project: string }) {
  const matchRoute = useMatchRoute();
  const { apps } = root.useLoaderData();
  const site = projectSiteOf(project);
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
                    params: { project },
                    fuzzy:
                      to === "/projects/$project/contexts/$" || to === "/projects/$project/repos",
                  }),
                )}
                render={<Link to={to} params={{ project }} />}
              >
                <Icon />
                <span>{label}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip={project}
              render={
                <a href={site} target="_blank" rel="noreferrer" aria-label={`Open ${project}`} />
              }
            >
              <ExternalLink />
              <span>Project site</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          {apps.map((app) => (
            <SidebarMenuItem key={app.url}>
              <SidebarMenuButton
                tooltip={`${app.name} for ${project}`}
                render={
                  <a
                    href={`${app.url}/projects/${project}`}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`${app.name} for ${project}`}
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
