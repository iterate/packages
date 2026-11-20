// dash-agents-nav.tsx — THE DASH'S AGENTS IN ITS SIDEBAR, and the addresses of the two ways to see a
// context. A few agents at the top, the most recently active first: each its status, its title and
// one line (what it does now, how many subagents it has, or its path). An agent with agents below
// its path is one row, "and 5 subagents". "View all" is the Agents page.
//
// IN THE ICON RAIL (the sidebar collapsed) a row is its icon and its status dot alone, centred as
// the pages' icons are, and its tooltip says its title, its line and its path. The words hide by the
// sidebar's own `group-data-[collapsible=icon]` classes, as every other row's do.
//
// AN AGENT VIEW is `/agents/<path>` (`/agents?contextPath=/` for root), and the raw view of the
// same context is `/contexts/<path>` (`/contexts?contextPath=/` for root); both share `dashPaths`
// (#/lib/page-url.ts). The agent view takes any path: what makes an agent is its view, not where it
// lives.
import { ListIcon } from "lucide-react";
import { agentViewHref } from "./dash-href.ts";
import { kindIcon } from "#/components/agent-look.ts";
import { AgentTooltip, StatusDot } from "#/components/agents-nav.tsx";
import { ContextPathText } from "#/components/context-path-text.tsx";
import { SidebarRowSkeleton } from "#/components/app-shell.tsx";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "#/components/ui/sidebar.tsx";
import {
  agentDoing,
  agentGroups,
  agentTitle,
  subagentsLine,
  type AgentGroup,
  type AgentRow,
} from "#/lib/agent-summary.ts";
import { linkTo } from "#/lib/page-url.ts";

/** The sidebar shows this many agents. "View all" shows the rest. */
export const SIDEBAR_AGENTS = 6;

export function DashAgentsNav({
  agents,
  current,
  overview,
  overviewShown,
}: {
  /** The catalog's rows, live; undefined while the first answer is on its way. */
  agents: readonly AgentRow[] | undefined;
  /** The path of the agent view shown, if one is. */
  current: string | undefined;
  /** The Agents page's link: "View all". */
  overview: string;
  /** Whether the Agents page shows its list now. */
  overviewShown: boolean;
}) {
  const groups = agents ? agentGroups(agents).slice(0, SIDEBAR_AGENTS) : undefined;
  return (
    <SidebarGroup>
      <SidebarGroupLabel>Agents</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {groups ? (
            groups.map((group) => (
              <AgentsNavRow
                key={group.row.path}
                group={group}
                active={
                  !!current &&
                  (current === group.row.path || current.startsWith(`${group.row.path}/`))
                }
              />
            ))
          ) : (
            // three rows' room while the catalog is read
            <SidebarMenuItem aria-label="Reading the agents">
              <SidebarRowSkeleton className={SKELETON_ROW} />
              <SidebarRowSkeleton className={SKELETON_ROW} />
              <SidebarRowSkeleton className={SKELETON_ROW} />
            </SidebarMenuItem>
          )}
          {groups?.length === 0 ? (
            <p className="px-2 py-1 font-readme text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
              No agents yet.
            </p>
          ) : null}
          <SidebarMenuItem>
            <SidebarMenuButton
              isActive={overviewShown}
              tooltip="View all agents"
              render={<a {...linkTo(overview)} />}
            >
              <ListIcon />
              <span>View all</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

/** A row's room while the catalog is read; in the icon rail, the icon's room alone. */
const SKELETON_ROW =
  "h-12 group-data-[collapsible=icon]:h-8 group-data-[collapsible=icon]:[&>:last-child]:hidden";

/** One agent: its kind's icon with its status on the corner, its title, and its one line. In the
 *  icon rail, the icon alone, with the words in its tooltip. */
function AgentsNavRow({ group, active }: { group: AgentGroup; active: boolean }) {
  const { row, subagents } = group;
  const KindIcon = kindIcon(row.kind);
  const line = [subagentsLine(subagents.length), agentDoing(row)].filter(Boolean).join(" · ");
  return (
    <SidebarMenuItem data-agent-path={row.path}>
      <SidebarMenuButton
        size="lg"
        isActive={active}
        // in the rail the large row is the same square as the pages' rows, its icon centred
        className="group-data-[collapsible=icon]:p-2!"
        tooltip={{ children: <AgentTooltip title={agentTitle(row)} line={line} path={row.path} /> }}
        // the link's name, also in the rail, where the row's words are not drawn
        render={<a aria-label={agentTitle(row)} {...linkTo(agentViewHref(row.path))} />}
      >
        <span className="relative">
          <KindIcon data-agent-kind={row.kind || undefined} />
          {row.status ? <StatusDot status={row.status} /> : null}
        </span>
        {/* an agent with no title is its path, once, on line one */}
        <span className="flex min-w-0 flex-col group-data-[collapsible=icon]:hidden">
          {row.title ? (
            <span className="truncate text-sm">{agentTitle(row)}</span>
          ) : (
            <ContextPathText path={row.path} truncate className="text-xs" />
          )}
          {line ? (
            <span className="truncate text-2xs text-muted-foreground" data-agent-line>
              {line}
            </span>
          ) : row.title ? (
            <ContextPathText path={row.path} truncate className="text-2xs text-muted-foreground" />
          ) : null}
        </span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
