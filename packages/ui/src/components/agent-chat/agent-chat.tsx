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
// `useIterateContext(stub, AgentChat.contextOptions)` returns, and each thing the chat does to the
// agent is a callback. Nothing here imports the SDK's client or a router:
//
//   const log = useIterateContext(agent, AgentChat.contextOptions);
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
  useCallback,
  useEffect,
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
import { agentFeedOf, foldAgentLog, traceOffsetByMessage } from "./agent-events.ts";
import {
  initialAgentUiState,
  type AgentUiItem,
  type AgentUiLlmStep,
  type AgentUiState,
} from "./agent-ui-reducer.ts";
import type { Inspect, SignedUrl } from "./agent-feed.tsx";
import { AgentFeedList } from "./agent-feed-list.tsx";
import { InspectorSheet, type Inspected } from "./agent-inspectors.tsx";
import { AgentComposer, type StreamInterrupt } from "./composer.tsx";
import { useComposerDraft, type ComposerDraft } from "./use-composer-attachments.ts";
import { QueuedMessagesPanel } from "./queued-messages.tsx";
import type { StreamEvent } from "./stream-event.ts";
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
import {
  heldShare,
  OLDER_EXHAUSTED,
  type OlderPages,
} from "#/components/virtual-log/older-pages.ts";
import { ReadProgress } from "#/components/virtual-log/read-progress.tsx";
import { remembered } from "#/components/virtual-log/remembered.ts";

type AgentChatContext = ContextViewSource & { processors: { loaded: boolean } };
type Feed = ReturnType<typeof agentFeedOf>;

/** The feed before the read reaches the head, when what is held says nothing of now. */
const NOTHING_YET: Feed = { state: initialAgentUiState(), items: [] };

export function AgentChat({
  path,
  context,
  error: hostError,
  state,
  onStateChange,
  onMessage,
  onAppend,
  signedUrl,
  listing,
  itemFooter,
  renderers,
  inspectors,
}: {
  /** The agent's path, the Events tab's title. */
  path: string;
  /** The agent's context, live: what `useIterateContext(stub, AgentChat.contextOptions)` returns,
   *  typed structurally, as `ContextView`'s is. */
  context: AgentChatContext;
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
  /** What the project's catalog last heard from the agent (iterate/agents catalog.ts), or
   *  `undefined` before its row arrives. The strip says it for an agent iterate does not run (a
   *  coding session, say), which has no facet of its own to read. */
  listing: Listing | undefined;
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
  const [foldLog] = useState(() => remembered(foldAgentLog));
  const fold = useMemo(() => foldLog(context.events), [foldLog, context.events]);
  // a read that failed stands in the error, and is not to be asked for again and again
  const older = (!context.error && context.older) || OLDER_EXHAUSTED;
  const turn = agentTurnOf(context);
  const { idle, requestMayBeOpen } = turn;
  const feed = useMemo(
    () => (context.caughtUp ? agentFeedOf(fold, idle, requestMayBeOpen) : NOTHING_YET),
    [context.caughtUp, fold, idle, requestMayBeOpen],
  );
  const [toggled, onToggle] = useToggledIds();
  const draft = useComposerDraft();
  const { inspected, inspect, onInspect } = useTraces(state, onStateChange);
  const readingForTrace = traceWantsOlder(inspected, older, fold.events);
  // a newest page with nothing to say is no proof of silence: an idle agent's is all wakes
  const readingForFirstRow =
    context.caughtUp && !older.exhausted && feed.items.length === 0 && !feed.state.live;
  useReadOlderWhile(readingForTrace, older, fold.events);
  const logShare = heldShare(fold.events, context.head);
  const error = hostError || context.error;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ChatStrip
        turn={turn}
        listing={listing}
        feedState={feed.state}
        view={state.view}
        eventCount={fold.events.length}
        wholeLogHeld={older.exhausted}
        onViewChange={(view) => onStateChange({ view })}
      />
      {error ? (
        <p data-type="error" className="px-4 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {state.view === "events" ? (
        <EventsTab
          path={path}
          context={context}
          error={hostError}
          renderers={renderers}
          inspectors={inspectors}
          onAppend={onAppend}
          state={state}
          onStateChange={onStateChange}
        />
      ) : (
        <ChatTab
          feed={feed}
          events={fold.events}
          older={older}
          logShare={logShare}
          caughtUp={context.caughtUp}
          readingForFirstRow={readingForFirstRow}
          toggled={toggled}
          onToggle={onToggle}
          inspect={inspect}
          signedUrl={signedUrl}
          itemFooter={itemFooter}
          draft={draft}
          onMessage={onMessage}
          onAppend={onAppend}
        />
      )}
      <InspectorSheet
        events={fold.events}
        live={feed.state.live}
        inspected={inspected}
        readProgress={readingForTrace ? logShare : undefined}
        onInspect={onInspect}
      />
    </div>
  );
}

/** What a host passes `useIterateContext` for a chat. `consumes`: every durable event (the Events
 *  tab is the whole log) and, named, since a wildcard never matches an ephemeral, the streamed chunk
 *  windows the feed folds into the answer being written. The hook reads the newest page, and older
 *  pages as the reader scrolls up: the fold needs nothing older than the turns it shows
 *  (agent-ui-reducer.ts). */
AgentChat.contextOptions = {
  consumes: ["*", "events.iterate.com/agent/llm-response-frame"],
};

/** The agent facet's live state, the fields the strip reads (iterate/agents contract.ts
 *  `stateSchema`): a pause, the one open request, the one pending trigger, the answer whose script
 *  the loop has not asked to run yet, and the settled run whose note has not landed. A script the
 *  agent asked for is the CONTEXT's obligation, not in this state: the feed's running code step
 *  says so. */
const AgentLive = z.object({
  paused: z.object({ reason: z.string() }).nullable(),
  openRequest: z.object({ model: z.string() }).nullable(),
  pendingLlmRequestTrigger: z.object({}).nullable(),
  awaitingRun: z.object({}).nullable().default(null),
  unnotedRun: z.number().nullable().default(null),
});

/** What the agent facet says of the turn. Its live state rides the context's subscription, and its
 *  entry appears once the processors table has loaded, so there is no live state to wait for when
 *  the table could not be read, or loaded without the facet. The turn is over when the facet holds
 *  no obligation, a pause included (a paused loop owes no follow-up round). Without live state at
 *  all, the log alone decides: the reducer settles only once no step is running, and a follow-up
 *  round reopens an activity. */
function agentTurnOf({ liveState, processors }: AgentChatContext) {
  const live: LiveStateView | undefined = liveState.agent;
  const liveUnavailable = live
    ? live.status === "error"
    : Boolean(processors.error) ||
      (processors.loaded && !processors.rows.some((row) => row.hostedFacet?.name === "agent"));
  const parsed = AgentLive.safeParse(live?.value);
  const facet = parsed.success ? parsed.data : undefined;
  const facetIdle =
    facet &&
    !facet.openRequest &&
    !facet.pendingLlmRequestTrigger &&
    !facet.awaitingRun &&
    !facet.unnotedRun;
  return {
    facet,
    liveUnavailable,
    detail: live?.error || processors.error,
    idle: facet ? Boolean(facetIdle) : liveUnavailable,
    // the facet trails the log, so a request that just landed reads there as a pending trigger:
    // only a facet with no obligation at all says nothing is in flight
    requestMayBeOpen: !facetIdle,
  };
}

/** The catalog's word on an agent: its status (`working`, `idle`, `waiting`, `ended`) and one line
 *  on what it is doing now. */
type Listing = { status: string | null; activity: string | null };

const LISTED_STATUS: Record<string, { text: string; tone: "live" | "amber" | "muted" }> = {
  working: { text: "Working", tone: "live" },
  waiting: { text: "Waiting", tone: "amber" },
  idle: { text: "Idle", tone: "muted" },
  ended: { text: "Ended", tone: "muted" },
};

/** What the strip says the agent is doing. A script still running is the context's, read from the
 *  log: the feed's running code step. Without the agent facet, the catalog's row says it. */
function chatStatus(
  { facet, liveUnavailable }: ReturnType<typeof agentTurnOf>,
  listing: Listing | undefined,
  feedState: AgentUiState,
) {
  const listed = listing?.status && LISTED_STATUS[listing.status];
  if (!facet && listed)
    return {
      text: listing.activity ? `${listed.text} · ${listing.activity}` : listed.text,
      tone: listed.tone,
    };
  if (!facet)
    return {
      text: liveUnavailable ? "Live state unavailable" : "Connecting…",
      tone: "muted" as const,
    };
  if (facet.paused) return { text: `Paused — ${facet.paused.reason}`, tone: "amber" as const };
  const { live, summaryActivity } = feedState;
  if (live?.steps.some((step) => step.kind === "code" && step.status === "running"))
    return {
      text: `Running a script${summaryActivity ? ` · ${summaryActivity}` : ""}`,
      tone: "live" as const,
    };
  if (facet.openRequest)
    return { text: `Thinking · ${facet.openRequest.model}`, tone: "live" as const };
  if (facet.pendingLlmRequestTrigger) return { text: "About to think", tone: "live" as const };
  if (facet.awaitingRun) return { text: "About to run a script", tone: "live" as const };
  if (facet.unnotedRun) return { text: "Reading the script's result", tone: "live" as const };
  return { text: "Idle", tone: "muted" as const };
}

/** The agent's live status, and Chat | Events. */
function ChatStrip({
  turn,
  listing,
  feedState,
  view,
  eventCount,
  wholeLogHeld,
  onViewChange,
}: {
  turn: ReturnType<typeof agentTurnOf>;
  listing: Listing | undefined;
  feedState: AgentUiState;
  view: AgentChatState["view"];
  eventCount: number;
  wholeLogHeld: boolean;
  onViewChange: (view: AgentChatState["view"]) => void;
}) {
  const status = chatStatus(turn, listing, feedState);
  return (
    <div className="flex shrink-0 items-center gap-3 px-4 py-1">
      <span
        className="flex min-w-0 items-center gap-1.5 truncate text-xs text-muted-foreground"
        title={turn.detail}
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
      <Tabs
        value={view || "chat"}
        onValueChange={(value) => onViewChange(value === "chat" ? undefined : "events")}
        className="ml-auto"
      >
        <TabsList className="h-8 pointer-coarse:h-10">
          <TabsTrigger value="chat" className="text-xs">
            Chat
          </TabsTrigger>
          <TabsTrigger value="events" className="text-xs">
            Events
            <span className="font-mono text-2xs text-muted-foreground/70">
              {eventCount}
              {wholeLogHeld ? "" : "+"}
            </span>
          </TabsTrigger>
        </TabsList>
      </Tabs>
    </div>
  );
}

/** The raw log, with the agent's sentences and inspector bodies under the page's own. */
function EventsTab({
  path,
  context,
  error,
  renderers,
  inspectors,
  onAppend,
  state,
  onStateChange,
}: {
  path: string;
  context: AgentChatContext;
  error: string | undefined;
  renderers: EventRenderers | undefined;
  inspectors: EventInspectors | undefined;
  onAppend: ((events: unknown[]) => Promise<unknown>) | undefined;
  state: AgentChatState;
  onStateChange: (patch: Partial<AgentChatState>) => void;
}) {
  const allRenderers = useMemo(() => ({ ...agentEventRenderers, ...renderers }), [renderers]);
  const allInspectors = useMemo(() => ({ ...agentEventInspectors, ...inspectors }), [inspectors]);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ContextView
        // the view scrolls its own feed: it fills the tab
        className="min-h-0 w-full flex-1 py-2"
        columnClassName="mx-auto w-full max-w-3xl px-4 md:px-6"
        title={<span className="font-mono text-xs">{path}</span>}
        context={context}
        error={error}
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
  );
}

/** The conversation over the composer. */
function ChatTab({
  feed,
  events,
  older,
  logShare,
  caughtUp,
  readingForFirstRow,
  toggled,
  onToggle,
  inspect,
  signedUrl,
  itemFooter,
  draft,
  onMessage,
  onAppend,
}: {
  feed: Feed;
  events: readonly StreamEvent[];
  older: OlderPages;
  logShare: number;
  caughtUp: boolean;
  readingForFirstRow: boolean;
  toggled: ReadonlySet<string>;
  onToggle: (id: string) => void;
  inspect: Inspect;
  signedUrl: SignedUrl;
  itemFooter: ((item: AgentUiItem) => ReactNode) | undefined;
  draft: ComposerDraft;
  onMessage: ComponentProps<typeof AgentComposer>["onSubmit"];
  onAppend: ((events: unknown[]) => Promise<unknown>) | undefined;
}) {
  // the person's own words land in view, wherever they were reading
  const [followTail, setFollowTail] = useState(0);
  const traceOffsets = useMemo(() => traceOffsetByMessage(events), [events]);
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
  return (
    <AgentFeedList
      feed={feed}
      older={older}
      logShare={logShare}
      followTail={followTail}
      empty={
        <ChatEmpty caughtUp={caughtUp} readProgress={readingForFirstRow ? logShare : undefined} />
      }
      footer={
        <div className="pointer-events-none bg-linear-to-t from-background from-80% to-transparent px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:px-6">
          <div className="pointer-events-auto mx-auto w-full max-w-3xl">
            {/* Queued input grows the composer column; the feed follows on resize. */}
            <QueuedMessagesPanel
              messages={feed.state.queuedUserMessages}
              isInterrupting={interrupt?.isInterrupting || false}
              onInterrupt={interrupt?.run}
              signedUrl={signedUrl}
            />
            <AgentComposer
              draft={draft}
              placeholder="Message this agent"
              autoFocusMessage
              interrupt={interrupt}
              onSubmit={(message) => {
                setFollowTail((count) => count + 1);
                return onMessage(message);
              }}
              onAppendRaw={async (events) => {
                if (!onAppend) throw new Error("not connected");
                setFollowTail((count) => count + 1);
                await onAppend(events);
              }}
            />
          </div>
        </div>
      }
      toggledIds={toggled}
      onToggle={onToggle}
      inspect={inspect}
      traceOffsets={traceOffsets}
      signedUrl={signedUrl}
      itemFooter={itemFooter}
    />
  );
}

/** What the chat shows with no rows: the first read, older pages being read for a first row, or a
 *  log with nothing said on it. */
function ChatEmpty({
  caughtUp,
  readProgress,
}: {
  caughtUp: boolean;
  readProgress: number | undefined;
}) {
  if (!caughtUp)
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
        <Spinner className="size-4" /> Reading the log…
      </div>
    );
  if (readProgress !== undefined)
    return (
      <div className="py-6">
        <ReadProgress label="Reading the log" value={readProgress} />
      </div>
    );
  return (
    <Empty className="py-16">
      <EmptyHeader>
        <EmptyTitle>Nothing said yet</EmptyTitle>
        <EmptyDescription>
          Say something below. The agent answers with prose, or with a script it runs against the
          project.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

/** Which rows are opened in place, local to this page. */
function useToggledIds() {
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
  return [toggled, onToggle] as const;
}

/** The open trace, which the chat's state carries, and the ways to open one. */
function useTraces(state: AgentChatState, onStateChange: (patch: Partial<AgentChatState>) => void) {
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
  return { inspected, inspect, onInspect };
}

/** A trace reads what the chat does not: an LLM request's prompt is every context item before it,
 *  and a link can name a run below the pages held. */
function traceWantsOlder(inspected: Inspected, older: OlderPages, events: readonly StreamEvent[]) {
  if (older.exhausted) return false;
  if (inspected?.kind === "scriptRun")
    return inspected.requestOffset < (events[0]?.offset ?? Infinity);
  return inspected?.kind === "llmRequest";
}

/** Pages down the log for as long as `wanted`. */
function useReadOlderWhile(wanted: boolean, older: OlderPages, events: readonly StreamEvent[]) {
  const { loadOlder, loading } = older;
  const heldFrom = events[0]?.offset;
  // `heldFrom` too: a page can come and go inside one frame, with `loading` never seen to change
  useEffect(() => {
    if (wanted && !loading) loadOlder();
  }, [wanted, loading, loadOlder, heldFrom]);
}

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
