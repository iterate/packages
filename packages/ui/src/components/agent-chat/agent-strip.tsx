// THE STRIP over an agent's view (agent-shell.tsx draws it): one line of status, and Chat | Events.
// In a file of its own, with nothing of the Events tab in it, so that a page can draw the strip
// before the view it belongs to has loaded (agent-reading.tsx).
import { CircleIcon } from "lucide-react";
import { cn } from "cn";
import type { AgentChatState } from "./agent-chat-search.ts";
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
}) {
  return (
    <div className="flex shrink-0 items-center gap-3 px-4 py-1">
      {status?.text ? (
        <span
          className="flex min-w-0 items-center gap-1.5 truncate text-xs text-muted-foreground"
          title={status.detail}
          data-status={status.tone}
        >
          <CircleIcon
            className={cn(
              "size-2 shrink-0",
              status.tone === "live" && "animate-pulse fill-success text-success",
              status.tone === "amber" && "fill-warning text-warning",
              status.tone === "muted" && "fill-muted-foreground/40 text-muted-foreground/40",
            )}
          />
          <span className="truncate">{status.text}</span>
        </span>
      ) : null}
      {tabs ? (
        <Tabs
          value={view || "chat"}
          onValueChange={(value) =>
            onStateChange({ view: value === "chat" ? undefined : "events" })
          }
          className="ml-auto"
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
      ) : null}
    </div>
  );
}
