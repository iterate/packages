// THE AGENT CHAT: the mind's own agent's conversation, for any page that holds the agent's context:
// the view that the kind `agent` names (core/configs/default agent-kinds/agent.ts), on the shell
// every kind shares (agent-shell.tsx).
// An agent is a conversation on its own path (`/agents/...`), and everything it does is an event
// there. This is a window onto that log: a strip (the agent's live status, Chat | Events), the CHAT (the
// agent-UI reducer's items: messages, and the activities that open into rounds of script + result)
// over a composer, the EVENTS (the raw log, `ContextView`), and the TRACES (one right-edge sheet:
// an LLM request or a script run). It fills its parent, a flex column with a bounded height.
// A path that started over (`newVersion()`) is its current version in the chat and the traces
// (agent-events.ts `foldAgentLog`). A new version is a new conversation: what the chat had open of
// the last one (a trace, the inspected event) closes, and the feed goes to its end. The draft
// stays: it is the person's.
// `strip={false}` is the chat alone, for a page whose reader is no developer: no strip and no
// Events tab, and the agent's status is the feed's last row while it works. `eventsTab={false}`
// keeps the strip's status and drops the Events tab; `attach={false}` makes the composer take words
// only. A choice in the agent's words (`[[kind:value|label]]`, choice-in-words.tsx) is a button that
// calls `onChoice`, through a React context; with no `onChoice` it is its plain words.
// CONTROLLED, as `ContextView` is: the tab, the open trace and the Events tab's every choice are
// `state` (agent-chat-search.ts) and come back as an `onStateChange` patch, so a chat is a link.
// Only the activity rows opened in place stay local.
// SEVERAL PEOPLE IN ONE CHAT. Every member's words name their sender (the platform's stamp), in the
// feed and in the queue, and anyone may interrupt any answer. Another participant's bubbles stand at
// the left under their face and name (participant.tsx). With `presence` (lib/presence.ts), a stack
// of faces beside Chat | Events (in the strip, or in the page's own header: `asideIn`) shows who else
// has it open now (the platform's rows of their pages) and opens a card that says who can use the
// conversation, and the end of the feed shows who is typing (each page's own status) as their face
// with dots. Each message goes out with a key, so a send that is tried again lands once.
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
//     onMessage={({ message, files, key }) => mind.agents.get(path).message({ message, files }, { key })}
//     onAppend={(events) => agent.append(...events)}
//     signedUrl={async (file) => (await mind.files.get(file).url()).url}
//   />
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import type { AgentChatState } from "./agent-chat-search.ts";
import { ChatReading } from "./agent-reading.tsx";
import { AgentShell, type AgentShellStatus } from "./agent-shell.tsx";
import { AgentFootStatus } from "./agent-strip.tsx";
import { agentFeedOf, foldAgentLog } from "./agent-events.ts";
import { AGENT_FACT, agentLiveStateOf, sendToAgent, type StoreFiles } from "./agent-facts.ts";
import type { AgentProgressData } from "./agent-progress.ts";
import { AgentTurnStatus } from "./agent-feed.tsx";
import {
  initialAgentUiState,
  deriveAgentUiLiveStatus,
  isAgentUiLiveRowWorking,
  type AgentUiItem,
  type AgentUiLlmStep,
  type AgentUiState,
} from "./agent-ui-reducer.ts";
import type { Inspect, SignedUrl } from "./agent-feed.tsx";
import { AgentFeedList } from "./agent-feed-list.tsx";
import { TRACES_CLOSED, traceWantsOlder } from "./agent-traces.ts";
import { InspectorSheet, type Inspected } from "./agent-inspectors.tsx";
import { AgentComposer, type StreamInterrupt } from "./composer.tsx";
import { AgentChoiceProvider, type AgentChoiceHandlers } from "./choice-in-words.tsx";
import { useComposerDraft, type ComposerDraft } from "./use-composer-attachments.ts";
import { ConversationAccess, TypingStatus, type InCall, type MindFace } from "./presence-line.tsx";
import { QueuedMessagesPanel } from "./queued-messages.tsx";
import { sentByMe, type MessageSender, type StreamEvent } from "./stream-event.ts";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "#/components/ui/empty.tsx";
import type { LiveStateView } from "#/components/context-view/types.tsx";
import { RIGHT_EDGE_CLOSED } from "#/components/context-view/context-view-search.ts";
import type { ContextViewSource } from "#/components/context-view/context-view.tsx";
import {
  heldShare,
  OLDER_EXHAUSTED,
  type OlderPages,
} from "#/components/virtual-log/older-pages.ts";
import { remembered } from "#/components/virtual-log/remembered.ts";
import { WidgetHostProvider } from "#/components/widget/widget-row.tsx";
import { versionOf } from "#/lib/itx-session.ts";
import {
  isPresenceEvent,
  PRESENCE_EVENT_TYPES,
  usePresence,
  type PresentPrincipal,
} from "#/lib/presence.ts";

type AgentChatContext = ContextViewSource & {
  processors: { loaded: boolean };
  /** The version of the agent's path that `events` are of, as `useIterateContext` says it. A host
   *  that leaves it out never starts a new conversation. */
  version?: number;
  /** The rows are a saved copy, which says no version (`keptContext`, #/lib/itx-session.ts). */
  savedCopy?: boolean;
};
type Feed = ReturnType<typeof agentFeedOf>;

/** The feed before the read reaches the head, when what is held says nothing of now. */
const NOTHING_YET: Feed = { state: initialAgentUiState(), items: [] };

/** A status row for a shared conversation whose messages live in another context. Only the
 * agent's phase and current activity summary are rendered; no response, reasoning or script. */
export function AgentProgress(
  props: { progress: AgentProgressData } | { context: AgentChatContext; error?: string },
) {
  if ("progress" in props) {
    const { text, working, activity } = props.progress;
    if (!working && text === "Idle") return null;
    return (
      <div className="flex flex-col" data-testid="agent-progress">
        <AgentTurnStatus text={text} working={working} />
        {working && activity ? <p className="text-sm text-muted-foreground">{activity}</p> : null}
      </div>
    );
  }
  return <AgentContextProgress {...props} />;
}

function AgentContextProgress({ context, error }: { context: AgentChatContext; error?: string }) {
  const { turn, feed } = useAgentFeed(context);
  const status = chatStatus(turn, feed.state);
  // A shared room has no agent facet until the first message asks the agent to work.
  const noAgent =
    !context.liveState.agent && context.processors.loaded && !context.processors.error;
  const failure = error || context.error;
  if (noAgent && !failure) return null;
  if (failure || turn.liveUnavailable)
    return <AgentTurnStatus text={failure || "Agent status unavailable"} working={false} />;
  if (!context.caughtUp || status.tone === "muted") return null;
  const activity = deriveAgentUiLiveStatus(feed.state)?.statusText;
  return (
    <div className="flex flex-col" data-testid="agent-progress">
      <AgentTurnStatus text={status.text} working={status.tone === "live"} />
      {activity && status.tone === "live" && !status.text.includes(activity) ? (
        <p className="text-sm text-muted-foreground">{activity}</p>
      ) : null}
    </div>
  );
}

/** The agent's log folded (the current version alone), what its live state says of the turn, the
 *  feed, and the older pages the chat may read: none past the start of the current version. */
export function useAgentFeed(context: AgentChatContext) {
  const [foldLog] = useState(() => remembered(foldAgentLog));
  const fold = useMemo(() => foldLog(context.events), [foldLog, context.events]);
  const turn = agentTurnOf(context);
  const { idle, requestMayBeOpen } = turn;
  const feed = useMemo(
    () => (context.caughtUp ? agentFeedOf(fold, idle, requestMayBeOpen) : NOTHING_YET),
    [context.caughtUp, fold, idle, requestMayBeOpen],
  );
  // a read that failed stands in the error, and is not to be asked for again and again
  const older =
    (!context.error && fold.versionEndedAt === null && context.older) || OLDER_EXHAUSTED;
  return { fold, turn, feed, older };
}

export function AgentChat({
  path,
  context,
  error: hostError,
  state,
  onStateChange,
  onMessage,
  onAppend,
  storeFiles,
  signedUrl,
  itemFooter,
  strip = true,
  aboveComposer,
  empty,
  placeholder = "Message this agent",
  eventsTab = true,
  tabsInHeader,
  asideIn,
  attach = true,
  onChoice,
  choiceState,
  me,
  presence = false,
  inCall,
  mind,
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
  /** Say something to the agent: the mind's `itx.agents.get(path).message(…)`. `key` names this
   *  one message: hand it on as `message(input, { key })`, and a send tried again after a lost
   *  answer lands once. */
  onMessage: SendMessage;
  /** Append to the agent's context (`(events) => stub.append(...events)`): the composer's raw mode,
   *  the interrupt, and the Events tab's composer. The events are as a person wrote them, and the
   *  platform parses each. `undefined` until the host holds the context: nothing can be appended. */
  onAppend: ((events: unknown[]) => Promise<unknown>) | undefined;
  /** Stores a message's files under the agent's path, as `message()` does (a kind's host has it:
   *  agent-kind-view/types.ts). With it, the composer sends words and files as ONE
   *  `agent-ui/message-received` through `onAppend` (agent-facts.ts). Without it, words with files
   *  go through `onMessage`. */
  storeFiles?: StoreFiles;
  /** A signed download URL for a file under the agent's path, asked of the mind's root and not
   *  of the agent's context (`mind.files.get(path).url()`): only an iterate agent's context has
   *  `files`. */
  signedUrl: SignedUrl;
  /** A row of the page's own under a feed item, such as what the page recorded about a message
   *  (`item.offset` is the offset of the event that carried it). */
  itemFooter?: (item: AgentUiItem) => ReactNode;
  /** `false`: the chat alone, with no strip and no Events tab; the agent's status is the feed's last
   *  row instead. */
  strip?: boolean;
  /** A row of the page's own over the composer, in view while the person writes: what the agent is
   *  doing for them elsewhere on the page, say. */
  aboveComposer?: ReactNode;
  /** What the feed shows, centred, once the read is done and nothing has been said: a page's own
   *  greeting, in place of "Nothing said yet". While the log is being read the feed says so, and a
   *  read that failed shows its error alone. */
  empty?: ReactNode;
  /** The composer's text while it is empty. */
  placeholder?: string;
  /** `false`: the strip keeps the agent's status and has no Events tab (the raw log). */
  eventsTab?: boolean;
  /** `true`: the page draws Chat | Events in its own header (`AgentTabs`), the tab being
   *  `state.view`. No strip: the agent's status is a line at the feed's foot, over the composer. */
  tabsInHeader?: boolean;
  /** An element of the page's own header, beside its Chat | Events, where the chat draws who is
   *  here and who can use this conversation (with `presence`): the page keeps its place while
   *  presence is on, and the stack grows to its left, so the tabs do not move. `null` while the page has not drawn it yet. Where the chat draws its strip,
   *  the strip holds it instead. */
  asideIn?: HTMLElement | null;
  /** `false`: the composer takes words only: no `+`, so no files and no raw mode. */
  attach?: boolean;
  /** What a press of a choice in the agent's words does. Absent: a choice is its plain words. */
  onChoice?: AgentChoiceHandlers["onChoice"];
  /** A choice's state, drawn on its button: "chosen", or "busy" while its press is sent. */
  choiceState?: AgentChoiceHandlers["choiceState"];
  /** The viewer's address or actor id: their own messages have no line under them that says who
   *  sent them. Absent: every person's message has one. */
  me?: string;
  /** `true`: the page shows who else has the conversation open, from the context's subscription
   *  rows and lent stubs, and says whether it is hidden and when its person types, as an
   *  ephemeral status through `onAppend` that names its own row (`context.subscription`; none: it
   *  says nothing). For a page of a signed-in principal whose session appends to the context: `me`
   *  is then their actor id. A page whose reader may not append here leaves it off. */
  presence?: boolean;
  /** With `presence`: who of the principals here is in the agent's call, from the call's live
   *  state (the host's: the chat knows nothing else of a call). Their faces are marked, and the
   *  card says so. */
  inCall?: InCall;
  /** With `presence`: the mind, the first face of the stack of who is here. */
  mind?: MindFace;
}) {
  // the chat and its traces read each committed row as the reducer does; the Events tab takes the
  // raw log untouched
  const { fold, turn, feed, older } = useAgentFeed(context);
  const conversation = useConversation(context);
  const [toggled, onToggle] = useToggledIds();
  const draft = useComposerDraft();
  const keys = useMessageKeys();
  const { inspected, inspect, onInspect } = useTraces(state, onStateChange);
  useClosedWithItsConversation(conversation, state, onStateChange);
  const readingForTrace = traceWantsOlder(inspected, older, fold.events);
  // a newest page with nothing to say is no proof of silence: an idle agent's is all wakes
  const readingForFirstRow =
    context.caughtUp && !older.exhausted && feed.items.length === 0 && !feed.state.live;
  useReadOlderWhile(readingForTrace, older, fold.events);
  const logShare = heldShare(fold.events, context.head);
  // THE AGENT (agent-facts.ts) takes the Dash's words as a fact of its own, not as `message()`:
  // until the host can append, `message()` carries them
  const send = useMemo<SendMessage>(
    () =>
      onAppend ? (input) => sendToAgent(input, { onAppend, onMessage, storeFiles }) : onMessage,
    [onAppend, onMessage, storeFiles],
  );
  // a widget's words go as the person's, through the same send; each press is its own message
  const sendFromWidget = useCallback(
    (message: string) => {
      void send({ message, files: [], key: `widget:${crypto.randomUUID()}` });
    },
    [send],
  );
  // in a voice call the agent is spoken to, not idle: the strip says nothing then
  const status = chatStatus(turn, feed.state, (inCall?.size ?? 0) > 0);
  const here = usePresence({
    enabled: presence,
    rows: context.processors.rows,
    rpcStubs: context.presence.rpcStubs,
    events: fold.events,
    send: onAppend,
    me,
    subscription: context.subscription,
  });
  const wrote = useMemo(() => othersWhoWrote(feed.items, me), [feed.items, me]);
  const typing = useMemo(
    () => here.present.filter((principal) => !principal.me && principal.typing),
    [here.present],
  );
  // a page's status events are no row of the log: the Events tab and its count leave them out
  const logContext = useMemo(
    () =>
      context.events.some(isPresenceEvent)
        ? { ...context, events: context.events.filter((event) => !isPresenceEvent(event)) }
        : context,
    [context],
  );
  return (
    <AgentShell
      path={path}
      context={logContext}
      error={hostError}
      state={state}
      onStateChange={onStateChange}
      onAppend={onAppend}
      status={status}
      strip={strip}
      eventsTab={eventsTab}
      tabsInHeader={tabsInHeader}
      aside={
        presence ? (
          <ConversationAccess present={here.present} wrote={wrote} inCall={inCall} mind={mind} />
        ) : null
      }
      asideIn={asideIn}
      closeSheet={TRACES_CLOSED}
      sheet={
        <InspectorSheet
          events={fold.events}
          live={feed.state.live}
          items={feed.items}
          inspected={inspected}
          readProgress={readingForTrace ? logShare : undefined}
          onInspect={onInspect}
        />
      }
    >
      <AgentChoiceProvider onChoice={onChoice} choiceState={choiceState}>
        <WidgetHostProvider events={fold.events} onSend={sendFromWidget}>
          <ChatTab
            feed={feed}
            conversation={conversation}
            older={older}
            logShare={logShare}
            caughtUp={context.caughtUp}
            failed={Boolean(hostError || context.error)}
            readingForFirstRow={readingForFirstRow}
            toggled={toggled}
            onToggle={onToggle}
            inspect={inspect}
            signedUrl={signedUrl}
            itemFooter={itemFooter}
            me={me}
            agentPath={path}
            statusRow={strip ? null : chatStatusRow(status, feed.state)}
            aboveComposer={aboveComposer}
            empty={empty}
            placeholder={placeholder}
            draft={draft}
            keys={keys}
            onMessage={send}
            onAppend={onAppend}
            attach={attach}
            typingStatus={presence ? <TypingStatus typing={typing} /> : null}
            onTyping={presence ? here.typing : undefined}
            typing={typing}
          />
        </WidgetHostProvider>
      </AgentChoiceProvider>
    </AgentShell>
  );
}

/** What a host passes `useIterateContext` for a chat. `consumes`: every durable event (the Events
 *  tab is the whole log) and, named, since a wildcard never matches an ephemeral, the streamed
 *  windows the feed folds into the answer being written, and the pages' presence status (which
 *  also makes the log's row a page for `lib/presence`). The hook reads the newest page, and older
 *  pages as the reader scrolls up: the fold needs nothing older than the turns it shows
 *  (agent-ui-reducer.ts). */
AgentChat.contextOptions = {
  consumes: ["*", AGENT_FACT.llmResponseFrame, ...PRESENCE_EVENT_TYPES],
};

/** The person's words and files, as the composer hands them over. */
type OutgoingMessage = Parameters<ComponentProps<typeof AgentComposer>["onSubmit"]>[0];
/** What a host does with them. */
type SendMessage = (input: OutgoingMessage & { key: string }) => Promise<void>;

/** Everyone but the viewer who wrote in the rows the page holds, once each, in the order they
 *  first wrote. */
function othersWhoWrote(items: readonly AgentUiItem[], me: string | undefined): MessageSender[] {
  const byActor = new Map<string, MessageSender>();
  for (const item of items)
    if (item.kind === "user" && item.sender && !sentByMe(item.sender, me))
      byActor.set(item.sender.actor, byActor.get(item.sender.actor) || item.sender);
  return [...byActor.values()];
}

/** A KEY FOR EACH MESSAGE, kept while the same message is tried again: a send that failed (the
 *  answer was lost, the first try may have landed) goes out again under its first key, so the
 *  log holds it once. Another message, or a send that succeeded, starts a new key. A message is
 *  the same when its words and its files are: each file by its name, its type and its content.
 *  The keys belong to the draft, so `AgentChat` holds them beside it: they outlive a visit to
 *  the Events tab, as the draft does. */
function useMessageKeys() {
  const [page] = useState(() => crypto.randomUUID().slice(0, 12));
  const held = useRef<{ count: number; message?: string }>({ count: 0 });
  return useMemo(
    () => ({
      keyFor(input: OutgoingMessage) {
        const message = JSON.stringify([
          input.message,
          input.files.map((file) => [file.filename, file.contentType, contentMark(file.data)]),
        ]);
        if (held.current.message !== message) held.current.count += 1;
        held.current.message = message;
        return `${page}:${String(held.current.count)}`;
      },
      sent() {
        held.current.message = undefined;
      },
    }),
    [page],
  );
}

/** A file's content as a short mark: its length and a hash of every character (FNV-1a, 32 bits).
 *  It tells a person's own second file from their first; it is no proof against a forger, and
 *  needs none: the key is the sender's own. */
function contentMark(data: string): string {
  let hash = 0x811c9dc5;
  for (let at = 0; at < data.length; at++) hash = Math.imul(hash ^ data.charCodeAt(at), 0x01000193);
  return `${String(data.length)}:${(hash >>> 0).toString(16)}`;
}

/** What the agent facet says of the turn (its live state: agent-facts.ts). Its live state rides the
 *  context's subscription, and its entry appears once the processors table has loaded, so there is
 *  no live state to wait for when the table could not be read, or loaded without the facet. The
 *  turn is over when the facet holds no obligation: no open request, no input that waits for one,
 *  no script whose result the agent has not read. A pause is no obligation (a paused agent owes no
 *  follow-up round). Without live state at all, the log alone decides: the reducer settles only
 *  once no step is running, and a follow-up round reopens an activity. */
function agentTurnOf({ liveState, processors }: AgentChatContext) {
  const live: LiveStateView | undefined = liveState.agent;
  const liveUnavailable = live
    ? live.status === "error"
    : Boolean(processors.error) ||
      (processors.loaded && !processors.rows.some((row) => row.hostedFacet?.name === "agent"));
  const facet = agentLiveStateOf(live?.value);
  const facetIdle =
    facet &&
    facet.llmRequests.length === 0 &&
    facet.pendingTriggerOffsets.length === 0 &&
    facet.scriptCalls.every((call) => call.answered);
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

/** What the strip says the agent is doing. A script still running is the context's, read from the
 *  log: the feed's running code step. An open request is the answer's when one is open, else the
 *  first. Before the agent's live state is known it says nothing: the feed's loading state is the
 *  one thing that speaks of the wait. `inCall`: someone is in the agent's voice call, so an agent
 *  with no work says nothing, never "Idle". */
function chatStatus(
  { facet, liveUnavailable, detail }: ReturnType<typeof agentTurnOf>,
  feedState: AgentUiState,
  inCall = false,
): AgentShellStatus {
  if (!facet)
    return {
      text: liveUnavailable ? "Live state unavailable" : "",
      tone: "muted" as const,
      detail,
    };
  if (facet.paused) return { text: `Paused — ${facet.paused.reason}`, tone: "amber" as const };
  const { live } = feedState;
  const summaryActivity = deriveAgentUiLiveStatus(feedState)?.statusText;
  if (live?.steps.some((step) => step.kind === "code" && step.status === "running"))
    return {
      text: `Running a script${summaryActivity ? ` · ${summaryActivity}` : ""}`,
      tone: "live" as const,
    };
  const open =
    facet.llmRequests.find((request) => request.purpose === "answer") ?? facet.llmRequests[0];
  if (open) return { text: `Thinking · ${open.model}`, tone: "live" as const };
  if (facet.pendingTriggerOffsets.length > 0)
    return { text: "About to think", tone: "live" as const };
  if (facet.scriptCalls.some((call) => !call.answered))
    return { text: "About to run a script", tone: "live" as const };
  return { text: inCall ? "" : "Idle", tone: "muted" as const };
}

/** The status as the feed's last row, for a chat with no strip: a pause, or work the live row does
 *  not show already (a request not yet in the log, or a page that shows no steps). Idle and
 *  connecting say nothing. */
function chatStatusRow({ text, tone }: AgentShellStatus, feedState: AgentUiState) {
  if (tone === "amber") return <AgentTurnStatus text={text} working={false} />;
  if (tone === "live" && !isAgentUiLiveRowWorking(feedState))
    return <AgentTurnStatus text="Working…" working />;
  return null;
}

/** The conversation over the composer. */
function ChatTab({
  feed,
  conversation,
  older,
  logShare,
  caughtUp,
  failed,
  readingForFirstRow,
  toggled,
  onToggle,
  inspect,
  signedUrl,
  itemFooter,
  me,
  agentPath,
  statusRow,
  aboveComposer,
  empty,
  placeholder,
  draft,
  keys,
  onMessage,
  onAppend,
  attach,
  typingStatus,
  onTyping,
  typing,
}: {
  feed: Feed;
  /** Which conversation it is (`useConversation`): a new one is shown from its end. */
  conversation: number;
  older: OlderPages;
  logShare: number;
  caughtUp: boolean;
  failed: boolean;
  readingForFirstRow: boolean;
  toggled: ReadonlySet<string>;
  onToggle: (id: string) => void;
  inspect: Inspect;
  signedUrl: SignedUrl;
  itemFooter: ((item: AgentUiItem) => ReactNode) | undefined;
  me: string | undefined;
  agentPath: string;
  statusRow: ReactNode;
  aboveComposer: ReactNode;
  empty: ReactNode;
  placeholder: string;
  draft: ComposerDraft;
  /** The key of each message, which the chat holds beside the draft. */
  keys: ReturnType<typeof useMessageKeys>;
  onMessage: SendMessage;
  onAppend: ((events: unknown[]) => Promise<unknown>) | undefined;
  attach: boolean;
  /** Who is typing, in words for a screen reader; null where the page is no seat. */
  typingStatus: ReactNode;
  onTyping: ((isTyping: boolean) => void) | undefined;
  /** Everyone but the viewer who is typing now, for the end of the feed. */
  typing: readonly PresentPrincipal[];
}) {
  // the person's own words land in view, wherever they were reading
  const [followTail, setFollowTail] = useState(0);
  // THE INTERRUPT: cancellation is a property of new input, never a command: a developer item that
  // tells the model why its answer stopped. The platform stamps the person who appended it. The
  // agent settles the open request as cancelled when it lands.
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
      // each of the person's sends, and each new conversation, pins the view to the end
      followTail={followTail + conversation}
      empty={
        <ChatEmpty
          caughtUp={caughtUp}
          failed={failed}
          readProgress={readingForFirstRow ? logShare : undefined}
          empty={empty}
        />
      }
      after={statusRow}
      footer={
        <div className="pointer-events-none bg-linear-to-t from-background from-80% to-transparent px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:px-4 sm:pt-4 sm:pb-[max(1rem,env(safe-area-inset-bottom))] md:px-6">
          <div className="pointer-events-auto mx-auto w-full max-w-3xl">
            <AgentFootStatus />
            {typingStatus}
            {aboveComposer}
            {/* Queued input grows the composer column; the feed follows on resize. */}
            <QueuedMessagesPanel
              messages={feed.state.queuedUserMessages}
              isInterrupting={interrupt?.isInterrupting || false}
              onInterrupt={interrupt?.run}
              signedUrl={signedUrl}
              me={me}
            />
            <AgentComposer
              draft={draft}
              placeholder={placeholder}
              autoFocusMessage
              attach={attach}
              interrupt={interrupt}
              onTyping={onTyping}
              onSubmit={async (message) => {
                setFollowTail((count) => count + 1);
                await onMessage({ ...message, key: keys.keyFor(message) });
                keys.sent();
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
      signedUrl={signedUrl}
      itemFooter={itemFooter}
      me={me}
      agentPath={agentPath}
      typing={typing}
    />
  );
}

/** What the chat shows with no rows. While the log is being read, that it is: the first read, then
 *  how far the older pages have come toward a first row. Nothing for a read that `failed`: the
 *  shell shows its error. Only a log read through with nothing said on it is empty (the page's own
 *  `empty`, in the middle of the feed, if it gave one). */
function ChatEmpty({
  caughtUp,
  failed,
  readProgress,
  empty,
}: {
  caughtUp: boolean;
  failed: boolean;
  readProgress: number | undefined;
  empty: ReactNode;
}) {
  if (failed) return null;
  if (!caughtUp || readProgress !== undefined) return <ChatReading progress={readProgress} />;
  if (empty)
    return (
      <div data-slot="agent-chat-empty" className="flex h-full items-center justify-center py-6">
        {empty}
      </div>
    );
  return (
    <Empty className="py-16">
      <EmptyHeader>
        <EmptyTitle>Nothing said yet</EmptyTitle>
        <EmptyDescription>
          Say something below. The agent answers with prose, or with a script it runs against the
          mind.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

/** WHICH CONVERSATION THE CHAT SHOWS: 0, and one more each time a read of the agent's path says
 *  another version than the one it said before (`versionOf`: a saved copy, and a read before its
 *  first page, say none). */
function useConversation(context: AgentChatContext) {
  const version = versionOf(context);
  const [held, setHeld] = useState({ version, count: 0 });
  if (version && version !== held.version)
    setHeld({ version, count: held.version ? held.count + 1 : held.count });
  return held.count;
}

/** What the state has open of a conversation, and is closed when the next one starts: a trace and
 *  the Events tab's inspected event, which name events of the earlier version. The filters and the
 *  processors sheet stay: they are the person's choice of what to see. */
const CONVERSATION_CLOSED: Partial<AgentChatState> = { ...TRACES_CLOSED, event: undefined };

/** Closes what the state has open of the last conversation when `conversation` grows. */
function useClosedWithItsConversation(
  conversation: number,
  state: AgentChatState,
  onStateChange: (patch: Partial<AgentChatState>) => void,
) {
  const closedAt = useRef(conversation);
  const open = Boolean(state.llmRequest || state.scriptRun || state.event);
  useEffect(() => {
    if (closedAt.current === conversation) return;
    closedAt.current = conversation;
    if (open) onStateChange(CONVERSATION_CLOSED);
  }, [conversation, open, onStateChange]);
}

/** Which rows are opened in place, local to this page. */
export function useToggledIds() {
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
export function useTraces(
  state: AgentChatState,
  onStateChange: (patch: Partial<AgentChatState>) => void,
) {
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

/** Pages down the log for as long as `wanted`. */
export function useReadOlderWhile(
  wanted: boolean,
  older: OlderPages,
  events: readonly StreamEvent[],
) {
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
