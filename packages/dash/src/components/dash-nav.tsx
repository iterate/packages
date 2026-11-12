// The dash's own navigation inside the shared shell (`AppShell`, packages/ui): the mind's
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
import { ApprovalsAlert } from "@iterate-com/ui/components/approvals-alert";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@iterate-com/ui/components/ui/sidebar";
import { mindSiteOf } from "@iterate-com/ui/lib/mind-site";

/** The root loader's: the directory of apps this deployment has (apps.ts `appDirectory`), empty for
 *  a standalone Dash. */
const root = getRouteApi("__root__");

const MIND_PAGES = [
  { to: "/minds/$mind", label: "Overview", icon: LayoutDashboard },
  { to: "/minds/$mind/contexts/$", label: "Contexts", icon: Waypoints },
  { to: "/minds/$mind/repos", label: "Repos", icon: FolderGit2 },
  { to: "/minds/$mind/analytics", label: "Analytics", icon: ChartLine },
  { to: "/minds/$mind/mcp", label: "MCP", icon: Plug },
  { to: "/minds/$mind/secrets", label: "Secrets", icon: LockKeyhole },
  { to: "/minds/$mind/approvals", label: "Approvals", icon: ShieldCheck },
  { to: "/minds/$mind/integrations", label: "Integrations", icon: Blocks },
] as const;

/** The mind's pages, its own site, and the first-party apps opened on it: every app serves
 *  `/minds/<address>`, and its own gate signs the browser in to the mind there. */
export function MindNav({ mind, waiting = 0 }: { mind: string; waiting?: number }) {
  const matchRoute = useMatchRoute();
  const { apps } = root.useLoaderData();
  const site = mindSiteOf(mind);
  return (
    <SidebarGroup>
      <SidebarGroupContent>
        {/* REQUESTS THAT WAIT FOR A YES come before everything else on every page of the mind:
            an agent stands still until a member answers. The rail shows the icon alone. */}
        <ApprovalsAlert
          waiting={waiting}
          render={<Link to="/minds/$mind/approvals" params={{ mind }} />}
        />
        <SidebarMenu>
          {MIND_PAGES.map(({ to, label, icon: Icon }) => (
            <SidebarMenuItem key={to}>
              <SidebarMenuButton
                tooltip={label}
                // Contexts and Repos are splats (`/contexts/<any context path>`, `/repos/<name>`):
                // active on every path under them; the others only on their own page, so Overview
                // is not lit everywhere
                isActive={Boolean(
                  matchRoute({
                    to,
                    params: { mind },
                    fuzzy: to === "/minds/$mind/contexts/$" || to === "/minds/$mind/repos",
                  }),
                )}
                render={<Link to={to} params={{ mind }} />}
              >
                <Icon />
                <span>{label}</span>
              </SidebarMenuButton>
              {to === "/minds/$mind/approvals" && waiting > 0 ? (
                <SidebarMenuBadge className="bg-warning/20 text-foreground">
                  {waiting}
                </SidebarMenuBadge>
              ) : null}
            </SidebarMenuItem>
          ))}
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip={mind}
              render={
                <a href={site} target="_blank" rel="noreferrer" aria-label={`Open ${mind}`} />
              }
            >
              <ExternalLink />
              <span>Mind site</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          {apps.map((app) => (
            <SidebarMenuItem key={app.url}>
              <SidebarMenuButton
                tooltip={`${app.name} for ${mind}`}
                render={
                  <a
                    href={`${app.url}/minds/${mind}`}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`${app.name} for ${mind}`}
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
