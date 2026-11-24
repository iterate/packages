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
  exclude,
  overview,
  overviewShown,
  shrink = false,
}: {
  /** The catalog's rows, live; undefined while the first answer is on its way. */
  agents: readonly AgentRow[] | undefined;
  /** The path of the agent view shown, if one is. */
  current: string | undefined;
  /** Agent paths already pinned above this section, skipped so they are not listed twice. */
  exclude?: ReadonlySet<string>;
  /** The Agents page's link: "View all". */
  overview: string;
  /** Whether the Agents page shows its list now. */
  overviewShown: boolean;
  /** Let this group shrink on short viewports so the foot group stays in view. */
  shrink?: boolean;
}) {
  const groups = agents
    ? agentGroups(agents)
        .filter((group) => !exclude?.has(group.row.path))
        .slice(0, SIDEBAR_AGENTS)
    : undefined;
  const viewAll = (
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
  );
  return (
    <SidebarGroup className={shrink ? "min-h-0 overflow-hidden" : undefined}>
      <SidebarGroupLabel className={shrink ? "shrink-0" : undefined}>Agents</SidebarGroupLabel>
      <SidebarGroupContent className={shrink ? "flex min-h-0 flex-1 flex-col" : undefined}>
        <SidebarMenu
          className={
            shrink
              ? "no-scrollbar min-h-0 overflow-y-auto group-data-[collapsible=icon]:overflow-hidden"
              : undefined
          }
        >
          {groups ? (
            groups.map((group, index) => (
              <AgentsNavRow
                key={group.row.path}
                group={group}
                // at short viewports (<=740 px tall) show five rows so the foot links fit without scrolling
                className={index >= 5 ? "[@media(max-height:740px)]:hidden" : undefined}
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
          {!shrink ? viewAll : null}
        </SidebarMenu>
        {shrink ? <SidebarMenu className="mt-1 shrink-0">{viewAll}</SidebarMenu> : null}
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

/** A row's room while the catalog is read; in the icon rail, the icon's room alone. */
const SKELETON_ROW =
  "h-12 group-data-[collapsible=icon]:h-8 group-data-[collapsible=icon]:[&>:last-child]:hidden";

/** One agent: its kind's icon with its status on the corner, its title, and its one line. In the
 *  icon rail, the icon alone, with the words in its tooltip. */
export function AgentsNavRow({
  group,
  active,
  className,
  fallbackTitle,
  pinned = false,
}: {
  group: AgentGroup;
  active: boolean;
  className?: string;
  /** Title from the context catalog (`metadata.title`) when the agent row itself has no title yet. */
  fallbackTitle?: string;
  /** Marks a row pinned via context catalog tag (`pinned-in-dash`). */
  pinned?: boolean;
}) {
  const { row, subagents } = group;
  const KindIcon = kindIcon(row.kind);
  const title = row.title || fallbackTitle || "";
  const label = title || agentTitle(row);
  const line = [subagentsLine(subagents.length), agentDoing(row)].filter(Boolean).join(" · ");
  return (
    <SidebarMenuItem
      data-agent-path={row.path}
      data-pinned-agent={pinned ? "" : undefined}
      className={className}
    >
      <SidebarMenuButton
        size="lg"
        isActive={active}
        // in the rail the large row is the same square as the pages' rows, its icon centred;
        // ring-inset keeps the focus ring inside the scrolling list's overflow box in open and rail
        className="focus-visible:ring-inset group-data-[collapsible=icon]:p-2!"
        tooltip={{ children: <AgentTooltip title={label} line={line} path={row.path} /> }}
        // the link's name, also in the rail, where the row's words are not drawn
        render={<a aria-label={label} {...linkTo(agentViewHref(row.path))} />}
      >
        <span className="relative">
          <KindIcon data-agent-kind={row.kind || undefined} />
          {row.status ? <StatusDot status={row.status} /> : null}
        </span>
        {/* an agent with no title is its path, once, on line one */}
        <span className="flex min-w-0 flex-col group-data-[collapsible=icon]:hidden">
          {title ? (
            <span className="truncate text-sm">{title}</span>
          ) : (
            <ContextPathText path={row.path} truncate className="text-xs" />
          )}
          {line ? (
            <span className="truncate text-2xs text-muted-foreground" data-agent-line>
              {line}
            </span>
          ) : title ? (
            <ContextPathText path={row.path} truncate className="text-2xs text-muted-foreground" />
          ) : null}
        </span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
