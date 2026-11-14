// THE SHELL every kind's chat sits in: a strip (one line of status, Chat | Events), the Events tab
// (the raw log, `ContextView`) and a slot for one right-edge sheet. The Chat tab is the kind's own:
// its `children`. With none, the shell is the Events tab alone, which is what an agent whose kind has
// no view gets. `strip={false}` drops the strip, and with it the Events tab: the Chat tab alone, for
// a page whose reader is no developer. It fills its parent, a flex column with a bounded height.
//
// A kind's view (agent-kind-view/) builds on this, as iterate's `AgentChat` does:
//
//   html`<${ui.AgentShell} ...${props} status=${{ text: "Idle", tone: "muted" }}>
//     <${MyChat} … />
//   </${ui.AgentShell}>`
import { useMemo, type ReactNode } from "react";
import { CircleIcon } from "lucide-react";
import { cn } from "cn";
import type { AgentChatState } from "./agent-chat-search.ts";
import { agentEventInspectors } from "./agent-event-inspectors.tsx";
import { Tabs, TabsList, TabsTrigger } from "#/components/ui/tabs.tsx";
import type { EventInspectors } from "#/components/context-view/types.tsx";
import { ContextView, type ContextViewSource } from "#/components/context-view/context-view.tsx";
import { ContextPathText } from "#/components/context-path-text.tsx";

/** What the strip says the agent is doing, and how loudly. */
export type AgentShellStatus = {
  text: string;
  tone: "live" | "amber" | "muted";
  /** A tooltip: what went wrong, say. */
  detail?: string;
};

export function AgentShell({
  path,
  context,
  error: hostError,
  state,
  onStateChange,
  onAppend,
  status,
  strip = true,
  inspectors,
  sheet,
  closeSheet,
  children,
}: {
  /** The agent's path, the Events tab's title. */
  path: string;
  /** The agent's context, live (`useIterateContext`), typed structurally. */
  context: ContextViewSource;
  /** The host's own failure (opening the agent's context), shown over the context's. */
  error: string | undefined;
  state: AgentChatState;
  /** A patch to the state; an `undefined` value drops the key. */
  onStateChange: (patch: Partial<AgentChatState>) => void;
  /** Append to the agent's context: the Events tab's composer. */
  onAppend: ((events: unknown[]) => Promise<unknown>) | undefined;
  /** The strip's line. Omitted: the strip shows the tabs alone. */
  status?: AgentShellStatus;
  /** `false`: no strip, and the Chat tab alone, whatever `state.view` says. Without `children` the
   *  Events tab stays, with no strip over it. */
  strip?: boolean;
  /** Inspector bodies for the kind's own event types, over the agent ones. */
  inspectors?: EventInspectors;
  /** One right-edge sheet of the kind's own (iterate's traces), drawn over both tabs. */
  sheet?: ReactNode;
  /** The patch that closes `sheet`, which the Events tab's own inspector or sheet opening adds to
   *  its patch: one right edge. */
  closeSheet?: Partial<AgentChatState>;
  /** The Chat tab. Omitted: the Events tab alone. */
  children?: ReactNode;
}) {
  const error = hostError || context.error;
  const view = !children ? "events" : strip ? state.view : undefined;
  const allInspectors = useMemo(() => ({ ...agentEventInspectors, ...inspectors }), [inspectors]);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {strip ? (
        <ShellStrip
          status={status}
          view={view}
          hasChat={Boolean(children)}
          held={context.events.length}
          wholeLogHeld={!context.older || context.older.exhausted}
          onStateChange={onStateChange}
        />
      ) : null}
      {error ? (
        <p data-type="error" className="px-4 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {view === "events" ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <ContextView
            // the view scrolls its own feed: it fills the tab
            // and it is as wide as the tab: a log's rows are long
            className="min-h-0 w-full flex-1 py-2"
            title={<ContextPathText path={path} />}
            context={context}
            error={hostError}
            inspectors={allInspectors}
            onAppend={onAppend}
            state={state}
            onStateChange={(patch) =>
              onStateChange({
                // one right edge: the view's inspector or sheet opening closes the kind's sheet
                ...((patch.event !== undefined || patch.processors) && closeSheet),
                ...patch,
              })
            }
            emptyText="Nothing has happened on this agent yet."
          />
        </div>
      ) : (
        children
      )}
      {sheet}
    </div>
  );
}

/** The strip: one line of status, and Chat | Events. */
function ShellStrip({
  status,
  view,
  hasChat,
  held,
  wholeLogHeld,
  onStateChange,
}: {
  status: AgentShellStatus | undefined;
  view: AgentChatState["view"];
  hasChat: boolean;
  /** How many events are held, and whether they are the whole log: the Events tab's count. */
  held: number;
  wholeLogHeld: boolean;
  onStateChange: (patch: Partial<AgentChatState>) => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-3 px-4 py-1">
      {status ? (
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
      <Tabs
        value={view || "chat"}
        onValueChange={(value) => onStateChange({ view: value === "chat" ? undefined : "events" })}
        className="ml-auto"
      >
        <TabsList className="h-8 pointer-coarse:h-10">
          {hasChat ? (
            <TabsTrigger value="chat" className="text-xs">
              Chat
            </TabsTrigger>
          ) : null}
          <TabsTrigger value="events" className="text-xs">
            Events
            <span className="font-mono text-2xs text-muted-foreground/70">
              {held}
              {wholeLogHeld ? "" : "+"}
            </span>
          </TabsTrigger>
        </TabsList>
      </Tabs>
    </div>
  );
}
