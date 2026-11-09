// The sidebar's body for this app (the frame around it is packages/ui's AppShell): "New agent" and
// the project's agents at the top (sub-agents are not listed), most recently active first. Each
// shows its name or the first thing a person said to it, with its path beneath, an icon for what
// runs it and a dot for what it is doing (agent-summary.ts, kept live by use-agent-rows.ts; neither
// reads an agent). Pinned agents sit in their own list above, pins kept per project in this
// browser. "New agent" opens the project's home page, whose composer starts one with its first
// message (agents-home.tsx).
import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { BotIcon, BoxIcon, PinIcon, SquarePenIcon, SquareTerminalIcon } from "lucide-react";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@iterate-com/ui/components/ui/sidebar";
import { cn } from "cn";
import {
  agentTitle,
  orderAgents,
  topLevelAgents,
  type AgentRow,
  type AgentStatus,
} from "../lib/agent-summary.ts";
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
  const ordered = useMemo(() => orderAgents(topLevelAgents(agents), pinned), [agents, pinned]);
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
  const KindIcon = kindIcon(row.kind);
  return (
    <SidebarMenuItem data-agent-path={row.path}>
      <SidebarMenuButton
        size="lg"
        isActive={active}
        tooltip={row.activity ? `${row.path}: ${row.activity}` : row.path}
        render={<Link to="/projects/$slug" params={{ slug }} search={{ agent: row.path }} />}
      >
        <span className="relative">
          <KindIcon data-agent-kind={row.kind || undefined} />
          {row.status ? <StatusDot status={row.status} /> : null}
        </span>
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

/** What runs the agent: iterate's own, a coding session, or something else. */
function kindIcon(kind: string | null) {
  if (!kind || kind === "iterate") return BotIcon;
  if (kind === "claude" || kind === "codex" || kind === "opencode") return SquareTerminalIcon;
  return BoxIcon;
}

const STATUS_DOT: Record<AgentStatus, string> = {
  working: "bg-success animate-pulse",
  waiting: "bg-warning",
  idle: "bg-muted-foreground/60",
  ended: "border border-muted-foreground/60 bg-sidebar",
};

/** What the agent is doing, as a dot on the corner of its icon. */
function StatusDot({ status }: { status: AgentStatus }) {
  return (
    <span
      data-agent-status={status}
      title={status}
      className={cn(
        "absolute -right-0.5 -bottom-0.5 size-1.5 rounded-full ring-1 ring-sidebar",
        STATUS_DOT[status],
      )}
    />
  );
}
