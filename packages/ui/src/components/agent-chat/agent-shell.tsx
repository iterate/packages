// THE SHELL every kind's chat sits in: a strip (one line of status, Chat | Events), the Events tab
// (the raw log, `ContextView`) and a slot for one right-edge sheet. The Chat tab is the kind's own:
// its `children`. With none, the shell is the Events tab alone, which is what an agent whose kind has
// no view gets. `strip={false}` drops the strip, and with it the Events tab: the Chat tab alone, for
// a page whose reader is no developer. `eventsTab={false}` keeps the strip's status and drops the
// tabs and the Events tab. `tabsInHeader`: the page draws Chat | Events in its own header
// (`AgentTabs`), so the shell draws no strip, and the status is a line at the feed's foot
// (`AgentFootStatus`). `aside` is a control of the kind's own beside Chat | Events: in the strip,
// or, where the shell draws none, in `asideIn` (an element of the page's own header), through a
// portal.
// It fills its parent, a flex column with a bounded height.
//
// A kind's view (agent-kind-view/) builds on this, as iterate's `AgentChat` does:
//
//   html`<${ui.AgentShell} ...${props} status=${{ text: "Idle", tone: "muted" }}>
//     <${MyChat} … />
//   </${ui.AgentShell}>`
import { use, useMemo, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { AgentChatState } from "./agent-chat-search.ts";
import { agentEventInspectors } from "./agent-event-inspectors.tsx";
import { AgentFootStatusContext, AgentTabsInHeader } from "./agent-shell-contexts.ts";
import { AgentStrip, type AgentShellStatus } from "./agent-strip.tsx";
import type { EventInspectors } from "#/components/context-view/types.tsx";
import { ContextView, type ContextViewSource } from "#/components/context-view/context-view.tsx";
import { ContextPathText } from "#/components/context-path-text.tsx";

export type { AgentShellStatus };

export function AgentShell({
  path,
  context,
  error: hostError,
  state,
  onStateChange,
  onAppend,
  status,
  strip = true,
  eventsTab = true,
  tabsInHeader,
  aside,
  asideIn,
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
  /** The strip's line. Omitted, or with no text: the strip shows the tabs alone. */
  status?: AgentShellStatus;
  /** `false`: no strip, and the Chat tab alone, whatever `state.view` says. Without `children` the
   *  Events tab stays, with no strip over it. */
  strip?: boolean;
  /** `false`: the strip keeps its status, with no tabs, and the Chat tab is all there is. Without
   *  `children` the Events tab stays. */
  eventsTab?: boolean;
  /** `true`: the page draws Chat | Events in its own header, and its tab is `state.view`. No strip:
   *  the status is a line at the feed's foot. Omitted: what `AgentTabsInHeader` says, which is
   *  `false` unless a kind's frame was asked for it. */
  tabsInHeader?: boolean;
  /** A control of the kind's own beside Chat | Events (iterate's: who is here and can use this
   *  conversation). */
  aside?: ReactNode;
  /** An element of the page's own header, beside its Chat | Events, where `aside` is drawn when
   *  the shell draws no strip: the page keeps its place, so nothing moves when it comes. `null`
   *  while the page has not drawn it yet. */
  asideIn?: HTMLElement | null;
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
  const frameSays = use(AgentTabsInHeader);
  // `strip={false}` is the chat alone, with no tabs anywhere
  const inHeader = strip && (tabsInHeader ?? frameSays);
  const stripShown = strip && !inHeader;
  const view = !children ? "events" : strip && eventsTab ? state.view : undefined;
  const allInspectors = useMemo(() => ({ ...agentEventInspectors, ...inspectors }), [inspectors]);
  const foot = useMemo(() => (inHeader ? { status } : null), [inHeader, status]);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {stripShown ? (
        <AgentStrip
          status={status}
          view={view}
          hasChat={Boolean(children)}
          tabs={eventsTab || !children}
          held={context.events.length}
          wholeLogHeld={!context.older || context.older.exhausted}
          onStateChange={onStateChange}
          aside={aside}
        />
      ) : null}
      {!stripShown && asideIn ? createPortal(aside, asideIn) : null}
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
        <AgentFootStatusContext value={foot}>{children}</AgentFootStatusContext>
      )}
      {sheet}
    </div>
  );
}
