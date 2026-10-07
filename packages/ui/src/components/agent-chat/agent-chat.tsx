// THE AGENT CHAT: one agent's conversation, for any page that holds the agent's context. An agent
// is a conversation on its own path (`/agents/...`), and everything it does is an event there. This
// is a window onto that log: a strip (the agent's live status, Chat | Events), the CHAT (the
// agent-UI reducer's items: messages, and the activities that open into rounds of script + result)
// over a composer, the EVENTS (the raw log, `ContextView`), and the TRACES (one right-edge sheet:
// an LLM request or a script run). It fills its parent, a flex column with a bounded height.
// CONTROLLED, as `ContextView` is: the tab, the open trace and the Events tab's every choice are
// `state` (agent-chat-search.ts) and come back as an `onStateChange` patch, so a chat is a link.
// Only the activity rows opened in place stay local.
// THE HOST holds the agent's context and calls the SDK. `context` is what
// `useIterateContext(stub, agentChatContextOptions)` returns, and each thing the chat does to the
// agent is a callback. Nothing here imports the SDK's client or a router:
//
//   const log = useIterateContext(agent, agentChatContextOptions);
//   <AgentChat
//     path={path}
//     context={log}
//     error={connectError}
//     state={search}
//     onStateChange={(patch) => navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true })}
//     onMessage={({ message, files }) => project.agents.get(path).message({ message, files })}
//     onAppend={(events) => agent.append(...events)}
//     signedUrl={async (file) => (await agent.files.get(file).url()).url}
//   />
import {
  Fragment,
  useCallback,
  useMemo,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { CircleIcon } from "lucide-react";
import { z } from "zod";
import { cn } from "cn";
import type { AgentChatState } from "./agent-chat-search.ts";
import { agentEventInspectors, agentEventRenderers } from "./agent-event-renderers.tsx";
import { reduceAgentFeed, toAgentEvent, traceOffsetByMessage } from "./agent-events.ts";
import type { AgentUiItem, AgentUiLlmStep } from "./agent-ui-reducer.ts";
import {
  AgentFeedItemRow,
  AgentLiveActivity,
  type Inspect,
  type SignedUrl,
} from "./agent-feed.tsx";
import { InspectorSheet, type Inspected } from "./agent-inspectors.tsx";
import { AgentComposer, type StreamInterrupt } from "./composer.tsx";
import { Conversation, ConversationContent, ConversationScrollButton } from "./conversation.tsx";
import { QueuedMessagesPanel } from "./queued-messages.tsx";
import { Tabs, TabsList, TabsTrigger } from "#/components/ui/tabs.tsx";
import { Spinner } from "#/components/ui/spinner.tsx";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "#/components/ui/empty.tsx";
import type {
  EventInspectors,
  EventRenderers,
  LiveStateView,
} from "#/components/context-view/types.tsx";
import { RIGHT_EDGE_CLOSED } from "#/components/context-view/context-view-search.ts";
import { ContextView, type ContextViewSource } from "#/components/context-view/context-view.tsx";

/** What a host passes `useIterateContext` for a chat. `consumes`: every durable event (the Events
 *  tab is the whole log) and, named, since a wildcard never matches an ephemeral, the streamed chunk
 *  windows the feed folds into the answer being written. `history`: every page of the log, which
 *  the chat folds whole. */
export const agentChatContextOptions = {
  consumes: ["*", "events.iterate.com/agent/llm-response-frame"],
  history: "all" as const,
};

export function AgentChat({
  path,
  context,
  error: hostError,
  state,
  onStateChange,
  onMessage,
  onAppend,
  signedUrl,
  itemFooter,
  renderers,
  inspectors,
}: {
  /** The agent's path, the Events tab's title. */
  path: string;
  /** The agent's context, live: what `useIterateContext(stub, agentChatContextOptions)` returns,
   *  typed structurally, as `ContextView`'s is. */
  context: ContextViewSource & { processors: { loaded: boolean } };
  /** The host's own failure (opening the agent's context), shown over the context's. */
  error: string | undefined;
  /** The chat's state: a route's parsed search (`validateSearch: AgentChatState`), or a page's own. */
  state: AgentChatState;
  /** A patch to the state; an `undefined` value drops the key. */
  onStateChange: (patch: Partial<AgentChatState>) => void;
  /** Say something to the agent: the project's `itx.agents.get(path).message(…)`. */
  onMessage: ComponentProps<typeof AgentComposer>["onSubmit"];
  /** Append to the agent's context (`(events) => stub.append(...events)`): the composer's raw mode,
   *  the interrupt, and the Events tab's composer. The events are as a person wrote them, and the
   *  platform parses each. `undefined` until the host holds the context: nothing can be appended. */
  onAppend: ((events: unknown[]) => Promise<unknown>) | undefined;
  /** A signed download URL for a file under the agent's path: `stub.files.get(path).url()`. */
  signedUrl: SignedUrl;
  /** A row of the page's own under a feed item, such as what the page recorded about a message
   *  (`item.offset` is the offset of the event that carried it). */
  itemFooter?: (item: AgentUiItem) => ReactNode;
  /** The page's sentences for its own event types in the Events tab, over the agent's. */
  renderers?: EventRenderers;
  /** The page's inspector bodies for its own event types, over the agent's. */
  inspectors?: EventInspectors;
}) {
  // the chat and its traces read each committed row as the reducer does; the Events tab takes the
  // raw log untouched
  const events = useMemo(
    () =>
      context.events.flatMap((event) => {
        const committed = toAgentEvent(event);
        return committed ? [committed] : [];
      }),
    [context.events],
  );
  // The agent facet's live state rides the context's subscription. Its entry appears once the
  // processors table has loaded, so there is no live state to wait for when the table could not be
  // read, or loaded without the facet.
  const live: LiveStateView | undefined = context.liveState.agent;
  const liveUnavailable = live
    ? live.status === "error"
    : Boolean(context.processors.error) ||
      (context.processors.loaded &&
        !context.processors.rows.some((row) => row.hostedFacet?.name === "agent"));
  const facet = AgentLive.safeParse(live?.value);
  // The turn is over when the facet holds no obligation, a pause included (a paused loop owes no
  // follow-up round). Without live state at all, the log alone decides: the reducer settles only
  // once no step is running, and a follow-up round reopens an activity.
  const idle = facet.success
    ? !facet.data.openRequest && !facet.data.pendingLlmRequestTrigger
    : liveUnavailable;
  const feed = useMemo(() => reduceAgentFeed(events, idle), [events, idle]);
  // A script still running is the context's, read from the log: the feed's running code step.
  const runningScript =
    feed.state.live?.steps.some((step) => step.kind === "code" && step.status === "running") ??
    false;
  const traceOffsets = useMemo(() => traceOffsetByMessage(events), [events]);
  const [toggled, setToggled] = useState<ReadonlySet<string>>(() => new Set());
  const onToggle = useCallback(
    (id: string) =>
      setToggled((held) => {
        const next = new Set(held);
        if (!next.delete(id)) next.add(id);
        return next;
      }),
    [],
  );
  const inspected: Inspected = state.llmRequest
    ? { kind: "llmRequest", llmRequestOffset: state.llmRequest }
    : state.scriptRun
      ? { kind: "scriptRun", requestOffset: state.scriptRun }
      : null;
  const onInspect = useCallback(
    (next: Inspected) =>
      onStateChange({
        ...RIGHT_EDGE_CLOSED, // one right edge: a trace closes the Events tab's inspector and sheet
        llmRequest: next?.kind === "llmRequest" ? next.llmRequestOffset : undefined,
        scriptRun: next?.kind === "scriptRun" ? next.requestOffset : undefined,
      }),
    [onStateChange],
  );
  const inspect = useMemo<Inspect>(
    () => ({
      llmRequest: (llmRequestOffset) => onInspect({ kind: "llmRequest", llmRequestOffset }),
      scriptRun: (requestOffset) => onInspect({ kind: "scriptRun", requestOffset }),
    }),
    [onInspect],
  );
  const allRenderers = useMemo(() => ({ ...agentEventRenderers, ...renderers }), [renderers]);
  const allInspectors = useMemo(() => ({ ...agentEventInspectors, ...inspectors }), [inspectors]);
  // THE INTERRUPT: cancellation is a property of new input, never a command: a developer item that
  // tells the model why its answer stopped, marked as the person's so it counts as external input.
  // The agent settles the open request as cancelled when it lands.
  const interrupt = useAgentInterrupt({
    runningLlmRequestId: feed.state.live?.steps.findLast(
      (step): step is AgentUiLlmStep => step.kind === "llm" && step.status === "running",
    )?.llmRequestOffset,
    onInterrupt: onAppend
      ? async () => {
          await onAppend([
            {
              type: "events.iterate.com/agent/context-added",
              payload: {
                role: "developer",
                content: "The user interrupted the in-progress response from the web chat.",
                actor: { type: "user" },
                llmRequestPolicy: { behaviour: "interrupt-current-request" },
              },
            },
          ]);
        }
      : undefined,
  });
  const status = !facet.success
    ? {
        text: liveUnavailable ? "Live state unavailable" : "Connecting…",
        tone: "muted" as const,
      }
    : facet.data.paused
      ? { text: `Paused — ${facet.data.paused.reason}`, tone: "amber" as const }
      : runningScript
        ? {
            text: `Running a script${feed.state.summaryActivity ? ` · ${feed.state.summaryActivity}` : ""}`,
            tone: "live" as const,
          }
        : facet.data.openRequest
          ? { text: `Thinking · ${facet.data.openRequest.model}`, tone: "live" as const }
          : facet.data.pendingLlmRequestTrigger
            ? { text: "About to think", tone: "live" as const }
            : { text: "Idle", tone: "muted" as const };
  const error = hostError || context.error;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-3 px-4 py-1">
        <span
          className="flex min-w-0 items-center gap-1.5 truncate text-xs text-muted-foreground"
          title={live?.error || context.processors.error}
          data-status={status.tone}
        >
          <CircleIcon
            className={cn(
              "size-2 shrink-0",
              status.tone === "live" && "animate-pulse fill-emerald-500 text-emerald-500",
              status.tone === "amber" && "fill-amber-500 text-amber-500",
              status.tone === "muted" && "fill-muted-foreground/40 text-muted-foreground/40",
            )}
          />
          <span className="truncate">{status.text}</span>
        </span>
        <Tabs
          value={state.view || "chat"}
          onValueChange={(value) =>
            onStateChange({ view: value === "chat" ? undefined : "events" })
          }
          className="ml-auto"
        >
          <TabsList className="h-8">
            <TabsTrigger value="chat" className="text-xs">
              Chat
            </TabsTrigger>
            <TabsTrigger value="events" className="text-xs">
              Events
              <span className="font-mono text-[10px] text-muted-foreground/70">
                {events.length}
              </span>
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      {error ? (
        <p data-type="error" className="px-4 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {state.view === "events" ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <ContextView
            // the view scrolls its own feed: it fills the tab
            className="mx-auto min-h-0 w-full max-w-3xl flex-1 px-4 py-2 md:px-6"
            title={<span className="font-mono text-xs">{path}</span>}
            context={context}
            error={hostError}
            renderers={allRenderers}
            inspectors={allInspectors}
            onAppend={onAppend}
            state={state}
            onStateChange={(patch) =>
              onStateChange({
                // one right edge: the view's inspector or sheet opening closes the chat's traces
                ...((patch.event !== undefined || patch.processors) && {
                  llmRequest: undefined,
                  scriptRun: undefined,
                }),
                ...patch,
              })
            }
            emptyText="Nothing has happened on this agent yet."
          />
        </div>
      ) : (
        <>
          <Conversation className="min-h-0 flex-1">
            <ConversationContent className="mx-auto w-full max-w-3xl gap-0 px-4 py-2 md:px-6">
              {!context.caughtUp ? (
                <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                  <Spinner className="size-4" /> Reading the log…
                </div>
              ) : feed.items.length === 0 && !feed.state.live ? (
                <Empty className="py-16">
                  <EmptyHeader>
                    <EmptyTitle>Nothing said yet</EmptyTitle>
                    <EmptyDescription>
                      Say something below. The agent answers with prose, or with a script it runs
                      against the project.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : null}
              {feed.items.map((item) => (
                <Fragment key={item.id}>
                  <AgentFeedItemRow
                    item={item}
                    expanded={toggled.has(item.id)}
                    onToggle={onToggle}
                    inspect={inspect}
                    traceOffset={item.kind === "assistant" ? traceOffsets.get(item.id) : undefined}
                    signedUrl={signedUrl}
                  />
                  {itemFooter?.(item)}
                </Fragment>
              ))}
              <AgentLiveActivity
                state={feed.state}
                toggledIds={toggled}
                onToggle={onToggle}
                inspect={inspect}
              />
            </ConversationContent>
            <ConversationScrollButton />
          </Conversation>
          <div className="shrink-0 px-4 pb-4 pt-2 md:px-6">
            <div className="mx-auto w-full max-w-3xl">
              {/* Queued input grows the composer column; the feed follows on resize. */}
              <QueuedMessagesPanel
                messages={feed.state.queuedUserMessages}
                isInterrupting={interrupt?.isInterrupting || false}
                onInterrupt={interrupt?.run}
                signedUrl={signedUrl}
              />
              <AgentComposer
                autoFocusMessage
                interrupt={interrupt}
                onSubmit={onMessage}
                onAppendRaw={async (events) => {
                  if (!onAppend) throw new Error("not connected");
                  await onAppend(events);
                }}
              />
            </div>
          </div>
        </>
      )}
      <InspectorSheet
        events={events}
        live={feed.state.live}
        inspected={inspected}
        onInspect={onInspect}
      />
    </div>
  );
}

/** The agent facet's live state, the fields the strip reads (iterate/agents contract.ts
 *  `stateSchema`): a pause, the one open request, the one pending trigger. A script the agent asked
 *  for is the CONTEXT's obligation, not in this state: the feed's running code step says so. */
const AgentLive = z.object({
  paused: z.object({ reason: z.string() }).nullable(),
  openRequest: z.object({ model: z.string() }).nullable(),
  pendingLlmRequestTrigger: z.object({}).nullable(),
});

/** The interrupt affordance for the running turn, shared by the composer and the queued
 *  panel. Null while nothing is running, so consumers gate on existence. */
function useAgentInterrupt(args: {
  onInterrupt: (() => Promise<void>) | undefined;
  runningLlmRequestId: number | undefined;
}): StreamInterrupt | null {
  const [isInterrupting, setIsInterrupting] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const { onInterrupt, runningLlmRequestId } = args;
  // An interrupt error belongs to the turn it failed against; without this a stale error would
  // resurface on the NEXT turn. State-adjust-during-render per react.dev — no effect.
  const [errorRequestId, setErrorRequestId] = useState(runningLlmRequestId);
  if (errorRequestId !== runningLlmRequestId) {
    setErrorRequestId(runningLlmRequestId);
    setError(undefined);
  }
  if (!onInterrupt || runningLlmRequestId === undefined) return null;
  return {
    isInterrupting,
    error,
    run: async () => {
      if (isInterrupting) return;
      setIsInterrupting(true);
      setError(undefined);
      try {
        await onInterrupt();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        setIsInterrupting(false);
      }
    },
  };
}
