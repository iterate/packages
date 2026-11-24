// agent-context.tsx — ONE CONVERSATION LAYOUT for a page whose feed is a HOST's log (a room, a
// call), not an agent's: the host's own rows (`renderers`), messages from other agents, the agent's
// SETTLED WORK from the agent's own log (`agentContext`: the chat's folded activity rows and its
// trace sheet), and the lines SAID in a call (`spokenLine`), every run of them one quiet row. The
// agent's work in flight is one progress line in the tail. Slots take the call bar, the captions
// over the composer and a canvas. The rows and their merge by time are agent-context-rows.ts.
// `activityRows={false}` keeps the agent's scripts from a reader who must not see them.
import { useCallback, useMemo, type ComponentProps, type ReactNode } from "react";
import { cn } from "cn";
import {
  agentLogTrailsHost,
  placeRows,
  rolledUp,
  settledActivities,
  type AgentContextRow,
} from "./agent-context-rows.ts";
import { AgentShell } from "#/components/agent-chat/agent-shell.tsx";
import {
  AgentProgress,
  useAgentFeed,
  useReadOlderWhile,
  useToggledIds,
  useTraces,
} from "#/components/agent-chat/agent-chat.tsx";
import { TRACES_CLOSED, traceWantsOlder } from "#/components/agent-chat/agent-traces.ts";
import {
  AgentFeedItemRow,
  type Inspect,
  type SignedUrl,
} from "#/components/agent-chat/agent-feed.tsx";
import { InspectorSheet } from "#/components/agent-chat/agent-inspectors.tsx";
import { Composer, Feed, Markdown } from "#/components/agent-chat/chat-parts.tsx";
import { toAgentEvent } from "#/components/agent-chat/agent-events.ts";
import type { StreamEvent } from "#/components/agent-chat/stream-event.ts";
import type {
  AgentMessageRow,
  AgentProgressData,
  SubagentActivity,
} from "#/components/agent-chat/agent-progress.ts";
import type { ContextViewSource } from "#/components/context-view/context-view.tsx";
import { heldShare } from "#/components/virtual-log/older-pages.ts";
import type { SpokenLine } from "#/components/call/spoken-lines.ts";
import { TranscriptRollup } from "#/components/call/transcript-rollup.tsx";

/** The agent's log when there is none to fold, or none to show: never caught up, so no rows. */
const NO_AGENT_LOG: AgentLog = {
  events: [],
  caughtUp: false,
  processors: { rows: [], loaded: false },
  presence: { actors: [], rpcStubs: [] },
  liveState: {},
};

/** No rows of these, as constants: a fresh `[]` each render would make the rows anew. */
const NO_MESSAGES: readonly AgentMessageRow[] = [];
const NO_ACTIVITIES: readonly SubagentActivity[] = [];

/** An activity row has no attachment to sign. */
const NO_FILES: SignedUrl = () => Promise.reject(new Error("an activity row has no files"));

type Append = ComponentProps<typeof AgentShell>["onAppend"];
type AgentLog = Extract<ComponentProps<typeof AgentProgress>, { context: unknown }>["context"];
export type AgentContextRenderer = (event: StreamEvent, actions: { onAppend: Append }) => ReactNode;

type Source = Pick<ContextViewSource, "events" | "caughtUp" | "older" | "head" | "error"> &
  Partial<ContextViewSource> & {
    append?: Append;
  };

export function AgentContext({
  path,
  context,
  state,
  onStateChange,
  onMessage,
  onAppend = context.append,
  renderers,
  spokenLine,
  me = "",
  progress,
  agentContext,
  agentError,
  activityRows = true,
  messages = NO_MESSAGES,
  activities = NO_ACTIVITIES,
  call,
  captions,
  canvas,
  footer,
  empty,
  placeholder,
  status,
  strip,
  eventsTab,
  bodyClassName,
  feedClassName,
}: {
  path: string;
  context: Source;
  state: ComponentProps<typeof AgentShell>["state"];
  onStateChange: ComponentProps<typeof AgentShell>["onStateChange"];
  onMessage: ComponentProps<typeof Composer>["onMessage"];
  onAppend?: Append;
  renderers: Readonly<Record<string, AgentContextRenderer>>;
  /** A line said in the call, for an event that is one: such an event needs no renderer, and every
   *  run of them is one quiet row that opens. */
  spokenLine?: (event: StreamEvent) => SpokenLine | null;
  /** The viewer's address, for "(you)" in an opened run of spoken lines, and for their own messages,
   *  which have no line under them that says who sent them. */
  me?: string;
  progress?: AgentProgressData;
  /** The agent's own log: its work in flight is the progress line, its settled work rows of the
   *  feed that open into rounds of script and result, and into the trace sheet. */
  agentContext?: AgentLog;
  agentError?: string;
  /** `false`: no row of the agent's work and no trace sheet, for a reader who must not see the
   *  agent's scripts. The progress line stays. */
  activityRows?: boolean;
  messages?: readonly AgentMessageRow[];
  activities?: readonly SubagentActivity[];
  call?: ReactNode;
  captions?: ReactNode;
  canvas?: ReactNode;
  footer?: ReactNode;
  empty?: ReactNode;
  placeholder?: string;
  status?: ComponentProps<typeof AgentShell>["status"];
  /** `false`: the feed alone, with no strip and no Events tab (the shell's `strip`), for a reader
   *  who must not see the host's raw log. */
  strip?: ComponentProps<typeof AgentShell>["strip"];
  /** `false`: the strip keeps its status line and loses the Events tab (the shell's `eventsTab`),
   *  for a reader who may see what the room is doing, but not the host's raw log. */
  eventsTab?: ComponentProps<typeof AgentShell>["eventsTab"];
  bodyClassName?: string;
  feedClassName?: string;
}) {
  const work = useAgentWork(activityRows ? agentContext : undefined, state, onStateChange);
  const events = useMemo(
    () => context.events.flatMap((raw) => toAgentEvent(raw) ?? []),
    [context.events],
  );
  const placed = useMemo(
    () => placeRows({ events, renderers, spokenLine, messages, activities: work.settled }),
    [events, renderers, spokenLine, messages, work.settled],
  );
  const rows = useMemo(() => rolledUp(placed), [placed]);
  // a trace reads the agent's older pages, and so does a host's row older than the agent's log
  useReadOlderWhile(
    work.readingForTrace || agentLogTrailsHost(placed, work.events, work.older),
    work.older,
    work.events,
  );
  const [toggled, onToggle] = useToggledIds();
  const { inspect } = work;
  const render = useCallback(
    (row: AgentContextRow) => (
      <ContextRow
        row={row}
        renderers={renderers}
        onAppend={onAppend}
        toggled={toggled}
        onToggle={onToggle}
        inspect={inspect}
        me={me}
      />
    ),
    [renderers, onAppend, toggled, onToggle, inspect, me],
  );
  // HTTP snapshots deliberately carry no processor or presence introspection.
  const shellContext = {
    processors: context.processors || { rows: [] },
    presence: context.presence || { actors: [], rpcStubs: [] },
    liveState: context.liveState || {},
    ...context,
  };
  const emptyContent =
    context.caughtUp &&
    !context.error &&
    !context.older?.loading &&
    context.older?.exhausted !== false
      ? empty
      : undefined;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {call}
      <div className={cn("flex min-h-0 flex-1", bodyClassName)}>
        <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col", feedClassName)}>
          <AgentShell
            path={path}
            context={shellContext}
            error={context.error}
            state={state}
            onStateChange={onStateChange}
            onAppend={onAppend}
            status={status}
            strip={strip}
            eventsTab={eventsTab}
            closeSheet={work.sheet && TRACES_CLOSED}
            sheet={work.sheet}
          >
            <Feed
              rows={rows}
              renderRow={render}
              older={context.error ? undefined : context.older}
              empty={emptyContent}
              tail={
                <>
                  {rows.length === 0 ? emptyContent : null}
                  <ProgressLine progress={progress} context={agentContext} error={agentError} />
                  <SubagentActivities activities={activities} />
                </>
              }
              footer={
                <div className="flex flex-col gap-2">
                  {footer}
                  {captions}
                  <Composer onMessage={onMessage} onAppend={onAppend} placeholder={placeholder} />
                </div>
              }
            />
          </AgentShell>
        </div>
        {canvas}
      </div>
    </div>
  );
}

/** The agent's settled work, from its own log folded as the chat folds it: the activities, the
 *  trace sheet over them, and what reading its older pages needs. No log: none of it. */
function useAgentWork(
  agentContext: AgentLog | undefined,
  state: ComponentProps<typeof AgentShell>["state"],
  onStateChange: ComponentProps<typeof AgentShell>["onStateChange"],
) {
  const log = agentContext || NO_AGENT_LOG;
  const { fold, feed, older } = useAgentFeed(log);
  const settled = useMemo(() => settledActivities(feed.items), [feed.items]);
  const { inspected, inspect, onInspect } = useTraces(state, onStateChange);
  const readingForTrace = traceWantsOlder(inspected, older, fold.events);
  const sheet = agentContext ? (
    <InspectorSheet
      events={fold.events}
      live={feed.state.live}
      inspected={inspected}
      readProgress={readingForTrace ? heldShare(fold.events, log.head) : undefined}
      onInspect={onInspect}
    />
  ) : undefined;
  return { events: fold.events, older, settled, inspect, readingForTrace, sheet };
}

/** One row of the feed, by its kind. */
function ContextRow({
  row,
  renderers,
  onAppend,
  toggled,
  onToggle,
  inspect,
  me,
}: {
  row: AgentContextRow;
  renderers: Readonly<Record<string, AgentContextRenderer>>;
  onAppend: Append;
  toggled: ReadonlySet<string>;
  onToggle: (id: string) => void;
  inspect: Inspect;
  me: string;
}) {
  switch (row.kind) {
    case "message":
      return <AgentMessage message={row.message} />;
    case "activity":
      return (
        <AgentFeedItemRow
          item={row.activity}
          expanded={toggled.has(row.activity.id)}
          onToggle={onToggle}
          inspect={inspect}
          signedUrl={NO_FILES}
          me={me}
        />
      );
    case "rollup": {
      // A run's open state is held by one of its LINES, not by the row's key: the key names the
      // row before the run, and that row changes when the agent's older work lands in front of
      // the run or inside it. The run that holds an opened line is open.
      const opened = row.lines.filter((line) => toggled.has(line.key));
      const first = row.lines[0];
      return (
        <TranscriptRollup
          lines={row.lines}
          me={me}
          expanded={opened.length > 0}
          onToggle={() => {
            if (opened.length > 0) for (const line of opened) onToggle(line.key);
            else if (first) onToggle(first.key);
          }}
        />
      );
    }
    case "event":
      return renderers[row.event.type]?.(row.event, { onAppend });
  }
}

/** The agent's work in flight: the host's own progress, or else the agent's log's. */
function ProgressLine({
  progress,
  context,
  error,
}: {
  progress: AgentProgressData | undefined;
  context: AgentLog | undefined;
  error: string | undefined;
}) {
  if (progress) return <AgentProgress progress={progress} />;
  if (context) return <AgentProgress context={context} error={error} />;
  return null;
}

export function AgentMessage({ message }: { message: AgentMessageRow }) {
  return (
    <div className="py-2" data-kind="agent-message">
      <div className="mb-1 text-xs text-muted-foreground">
        From <span className="font-mono">{message.from}</span>
      </div>
      <Markdown>{message.text}</Markdown>
    </div>
  );
}

export function SubagentActivities({ activities }: { activities: readonly SubagentActivity[] }) {
  if (!activities.length) return null;
  return (
    <details className="py-1 text-xs text-muted-foreground" data-testid="subagent-activity">
      <summary>
        {activities.length} {activities.length === 1 ? "agent active" : "agents active"}
      </summary>
      <ul className="mt-2 flex flex-col gap-1">
        {activities.map((agent) => (
          <li key={agent.path} title={agent.path} className="flex min-w-0 gap-2">
            <span className="shrink-0">{agent.status === "working" ? "Working" : "Waiting"}</span>
            <span className="truncate">
              {agent.title}
              {agent.activity ? ` · ${agent.activity}` : ""}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}
