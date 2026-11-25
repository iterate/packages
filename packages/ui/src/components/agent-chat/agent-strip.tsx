// THE STRIP over an agent's view (agent-shell.tsx draws it): one line of status, and Chat | Events.
// In a file of its own, with nothing of the Events tab in it, so that a page can draw the strip
// before the view it belongs to has loaded (agent-reading.tsx).
//
// A page that draws the tabs in its own header (the Dash's agent page) draws `AgentTabs` there and
// tells the shell `tabsInHeader`: the shell then draws no strip, and the status is a quiet line at
// the feed's foot, over the composer (`AgentFootStatus`, which `Feed` and the iterate chat draw).
// A kind's view in a sandboxed frame hears it through `AgentTabsInHeader`
// (agent-shell-contexts.ts), which the frame sets.
import { use, type ReactNode } from "react";
import { CircleIcon } from "lucide-react";
import { cn } from "cn";
import type { AgentChatState } from "./agent-chat-search.ts";
import { AgentFootStatusContext } from "./agent-shell-contexts.ts";
import { Tabs, TabsList, TabsTrigger } from "#/components/ui/tabs.tsx";

/** What the strip says the agent is doing, and how loudly. */
export type AgentShellStatus = {
  text: string;
  tone: "live" | "amber" | "muted";
  /** A tooltip: what went wrong, say. */
  detail?: string;
};

/** The strip: one line of status, and Chat | Events. */
export function AgentStrip({
  status,
  view,
  hasChat,
  tabs,
  held,
  wholeLogHeld,
  onStateChange,
  aside,
}: {
  status: AgentShellStatus | undefined;
  view: AgentChatState["view"];
  hasChat: boolean;
  /** `false`: the status alone. */
  tabs: boolean;
  /** How many events are held, and whether they are the whole log: the Events tab's count. None:
   *  the tab says no count. */
  held: number | undefined;
  wholeLogHeld: boolean;
  onStateChange: (patch: Partial<AgentChatState>) => void;
  /** A control of the kind's own, before the tabs (`AgentShell`'s `aside`). */
  aside: ReactNode;
}) {
  return (
    <div className="flex shrink-0 items-center gap-3 px-4 py-1">
      {status?.text ? <StatusText status={status} /> : null}
      <div className="ml-auto flex shrink-0 items-center gap-1">
        {aside}
        {tabs ? (
          <AgentTabs
            view={view}
            hasChat={hasChat}
            held={held}
            wholeLogHeld={wholeLogHeld}
            onStateChange={onStateChange}
          />
        ) : null}
      </div>
    </div>
  );
}

/** Chat | Events, with the Events tab's count: the strip's, or a page header's. */
export function AgentTabs({
  view,
  hasChat,
  held,
  wholeLogHeld,
  onStateChange,
  className,
}: {
  view: AgentChatState["view"];
  hasChat: boolean;
  /** How many events are held: the Events tab's count. None: the tab says no count. */
  held: number | undefined;
  /** `false`: older events are not held, and the count says "+". */
  wholeLogHeld: boolean;
  onStateChange: (patch: Partial<AgentChatState>) => void;
  className?: string;
}) {
  return (
    <Tabs
      value={view || "chat"}
      onValueChange={(value) => onStateChange({ view: value === "chat" ? undefined : "events" })}
      className={className}
    >
      <TabsList className="h-8 pointer-coarse:h-10">
        {hasChat ? (
          <TabsTrigger value="chat" className="text-xs">
            Chat
          </TabsTrigger>
        ) : null}
        <TabsTrigger value="events" className="text-xs">
          <span className="inline-flex items-baseline gap-1.5">
            Events
            {held === undefined ? null : (
              <span className="font-mono text-2xs text-muted-foreground/70">
                {held}
                {wholeLogHeld ? "" : "+"}
              </span>
            )}
          </span>
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}

/** THE STATUS AT THE FEED'S FOOT, over the composer, where the shell draws no strip: one line of a
 *  fixed height, there with no words too, so that the composer does not move when they change or
 *  go. Nothing where the shell draws a strip. */
export function AgentFootStatus() {
  const foot = use(AgentFootStatusContext);
  if (!foot) return null;
  return (
    <div data-slot="agent-foot-status" className="flex h-5 min-w-0 items-center px-1 pb-1">
      {foot.status?.text ? <StatusText status={foot.status} /> : null}
    </div>
  );
}

/** The dot and the words of a status. */
function StatusText({ status }: { status: AgentShellStatus }) {
  return (
    <span
      className="flex min-w-0 items-center gap-1.5 truncate text-xs text-muted-foreground"
      title={status.detail}
      data-status={status.tone}
    >
      <CircleIcon
        className={cn(
          "size-2 shrink-0",
          status.tone === "live" && "fill-success text-success",
          status.tone === "amber" && "fill-warning text-warning",
          status.tone === "muted" && "fill-muted-foreground/40 text-muted-foreground/40",
        )}
      />
      <span className="truncate">{status.text}</span>
    </span>
  );
}
