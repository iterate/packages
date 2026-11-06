// The sidebar's body for this app (the frame around it is packages/ui's AppShell): "New agent" and
// the project's agents, most recently active first. Each shows its name or the first thing a
// person said to it, with its path beneath (agent-summary.ts, kept live by use-agent-rows.ts;
// neither reads an agent). Pinned agents sit in their own list above, pins kept per project in this
// browser. "New agent" opens the project's home page, whose composer starts one with its first
// message (agents-home.tsx).
import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { BotIcon, PinIcon, SquarePenIcon } from "lucide-react";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@iterate-com/ui/components/ui/sidebar";
import { cn } from "cn";
import { agentTitle, orderAgents, type AgentRow } from "../lib/agent-summary.ts";
import { usePinnedAgents } from "../lib/use-pinned-agents.ts";

export function AgentsNav({
  project,
  slug,
  agents,
  agent,
  installed,
}: {
  /** the project's id — pins are kept under it */
  project: string;
  /** the project's slug — its URL (`/projects/<slug>`) */
  slug: string;
  /** whether the project has `itx.agents`: without it there is nothing to create an agent with */
  installed: boolean;
  agents: AgentRow[];
  /** the open agent; none on the home page */
  agent: string | undefined;
}) {
  const { pinned, togglePinned } = usePinnedAgents(project);
  const ordered = useMemo(() => orderAgents(agents, pinned), [agents, pinned]);
  const renderRow = (row: AgentRow) => (
    <AgentsNavRow
      key={row.path}
      slug={slug}
      row={row}
      active={row.path === agent}
      pinned={pinned.has(row.path)}
      onTogglePinned={() => togglePinned(row.path)}
    />
  );
  return (
    <>
      {installed ? (
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={!agent}
                  tooltip="New agent"
                  render={<Link to="/projects/$slug" params={{ slug }} />}
                >
                  <SquarePenIcon />
                  <span>New agent</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ) : null}
      {ordered.pinned.length > 0 ? (
        <SidebarGroup>
          <SidebarGroupLabel>Pinned</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{ordered.pinned.map(renderRow)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ) : null}
      <SidebarGroup>
        <SidebarGroupLabel>Agents</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            {agents.length === 0 ? (
              <p className="font-readme px-2 py-1 text-xs text-muted-foreground">No agents yet.</p>
            ) : null}
            {ordered.recent.map(renderRow)}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </>
  );
}

function AgentsNavRow({
  slug,
  row,
  active,
  pinned,
  onTogglePinned,
}: {
  slug: string;
  row: AgentRow;
  active: boolean;
  pinned: boolean;
  onTogglePinned: () => void;
}) {
  return (
    <SidebarMenuItem data-agent-path={row.path}>
      <SidebarMenuButton
        size="lg"
        isActive={active}
        tooltip={row.path}
        render={<Link to="/projects/$slug" params={{ slug }} search={{ agent: row.path }} />}
      >
        <BotIcon />
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm">{agentTitle(row)}</span>
          <span className="truncate font-mono text-2xs text-muted-foreground">{row.path}</span>
        </span>
      </SidebarMenuButton>
      <button
        type="button"
        data-sidebar="menu-action"
        aria-label={pinned ? "Unpin agent" : "Pin agent"}
        aria-pressed={pinned}
        onClick={onTogglePinned}
        className={cn(
          "absolute top-1/2 right-1 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground outline-hidden ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 group-data-[collapsible=icon]:hidden [&>svg]:size-3.5",
          // touch has no hover: the action shows there; a pointer reveals it on the row
          !pinned &&
            "md:opacity-0 md:group-hover/menu-item:opacity-100 md:focus-visible:opacity-100",
        )}
      >
        <PinIcon className={cn(pinned && "fill-current")} />
      </button>
    </SidebarMenuItem>
  );
}
