// The Agents app's sidebar body (the frame around it is AppShell): "New agent" and the mind's
// agents at the top (sub-agents are not listed), most recently active first. Each shows its name or
// the first thing a person said to it, with its path beneath, an icon for what runs it and a dot
// for what it is doing (lib/agent-summary.ts). Pinned agents sit in their own list above, pins kept
// per mind in this browser. It imports no router: a row is a link to `agentHref(path)`, and a
// plain left click on it is `onOpen`'s when the page has one.
import { useCallback, useEffect, useMemo, useState, type ComponentProps } from "react";
import { BotIcon, BoxIcon, PinIcon, SquarePenIcon, SquareTerminalIcon } from "lucide-react";
import { cn } from "cn";
import { z } from "zod";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "#/components/ui/sidebar.tsx";
import {
  agentTitle,
  orderAgents,
  topLevelAgents,
  type AgentRow,
  type AgentStatus,
} from "#/lib/agent-summary.ts";
import { plainLeftClick } from "#/lib/plain-left-click.ts";

/** Where an agent's chat is, and the home page for `undefined`. */
export type AgentHref = (path: string | undefined) => string;
/** Opens an agent's chat, or the home page for `undefined`, without leaving the page. */
export type OpenAgent = (path: string | undefined) => void;

/** A link to an agent's chat or the home page. A plain left click is `onOpen`'s; any other click
 *  is the browser's (a new tab). */
export function AgentLink({
  path,
  agentHref,
  onOpen,
  ...props
}: Omit<ComponentProps<"a">, "href" | "onClick"> & {
  path: string | undefined;
  agentHref: AgentHref;
  onOpen: OpenAgent | undefined;
}) {
  return (
    <a
      {...props}
      href={agentHref(path)}
      onClick={(event) => {
        if (!onOpen || !plainLeftClick(event)) return;
        event.preventDefault();
        onOpen(path);
      }}
    />
  );
}

export function AgentsNav({
  mind,
  agents,
  agent,
  installed = true,
  agentHref,
  onOpen,
}: {
  /** the mind's address: pins are kept under it */
  mind: string;
  /** whether the mind has `itx.agents`: without it there is nothing to create an agent with */
  installed?: boolean;
  agents: AgentRow[];
  /** the open agent; none on the home page */
  agent: string | undefined;
  agentHref: AgentHref;
  /** A page with a client router navigates here; without it a row is a plain link. */
  onOpen?: OpenAgent;
}) {
  const { pinned, togglePinned } = usePinnedAgents(mind);
  const ordered = useMemo(() => orderAgents(topLevelAgents(agents), pinned), [agents, pinned]);
  const renderRow = (row: AgentRow) => (
    <AgentsNavRow
      key={row.path}
      row={row}
      active={row.path === agent}
      pinned={pinned.has(row.path)}
      onTogglePinned={() => togglePinned(row.path)}
      agentHref={agentHref}
      onOpen={onOpen}
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
                  render={<AgentLink path={undefined} agentHref={agentHref} onOpen={onOpen} />}
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
  row,
  active,
  pinned,
  onTogglePinned,
  agentHref,
  onOpen,
}: {
  row: AgentRow;
  active: boolean;
  pinned: boolean;
  onTogglePinned: () => void;
  agentHref: AgentHref;
  onOpen: OpenAgent | undefined;
}) {
  const KindIcon = kindIcon(row.kind);
  return (
    <SidebarMenuItem data-agent-path={row.path}>
      <SidebarMenuButton
        size="lg"
        isActive={active}
        tooltip={row.activity ? `${row.path}: ${row.activity}` : row.path}
        render={<AgentLink path={row.path} agentHref={agentHref} onOpen={onOpen} />}
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

// ── pins ──
// The agents this person pinned, per mind, in this browser's localStorage: a viewer's
// convenience, never the mind's data. Read after mount (a server render has no storage); storage
// that throws (a private window, blocked site data) leaves pins in memory only.

const Pins = z.array(z.string());
const NONE: ReadonlySet<string> = new Set();

function storageKey(mind: string) {
  return `iterate-agents:pinned:${mind}`;
}

function readPins(mind: string): Set<string> {
  try {
    const parsed = Pins.safeParse(JSON.parse(localStorage.getItem(storageKey(mind)) ?? "[]"));
    return new Set(parsed.success ? parsed.data : []);
  } catch {
    return new Set();
  }
}

function usePinnedAgents(mind: string): {
  pinned: ReadonlySet<string>;
  togglePinned: (path: string) => void;
} {
  const [held, setHeld] = useState<{ mind: string; pinned: ReadonlySet<string> }>();
  useEffect(() => setHeld({ mind, pinned: readPins(mind) }), [mind]);
  const togglePinned = useCallback(
    (path: string) => {
      const next = new Set(held?.mind === mind ? held.pinned : readPins(mind));
      if (!next.delete(path)) next.add(path);
      try {
        localStorage.setItem(storageKey(mind), JSON.stringify([...next]));
      } catch {
        // storage refused: the pin holds for this page's life
      }
      setHeld({ mind, pinned: next });
    },
    [held, mind],
  );
  return {
    pinned: held?.mind === mind ? held.pinned : NONE,
    togglePinned,
  };
}
