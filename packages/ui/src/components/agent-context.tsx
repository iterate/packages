/** One conversation layout; hosts supply their authorized snapshots, rows and media parts. */
import { useCallback, useMemo, type ComponentProps, type ReactNode } from "react";
import { cn } from "cn";
import { AgentShell } from "#/components/agent-chat/agent-shell.tsx";
import { AgentProgress } from "#/components/agent-chat/agent-chat.tsx";
import { Composer, Feed, Markdown } from "#/components/agent-chat/chat-parts.tsx";
import { toAgentEvent } from "#/components/agent-chat/agent-events.ts";
import type { StreamEvent } from "#/components/agent-chat/stream-event.ts";
import type {
  AgentMessageRow,
  AgentProgressData,
  SubagentActivity,
} from "#/components/agent-chat/agent-progress.ts";
import type { ContextViewSource } from "#/components/context-view/context-view.tsx";

type Append = ComponentProps<typeof AgentShell>["onAppend"];
type Row = { key: string; at: string; order: number; offset?: number } & (
  | { kind: "event"; event: StreamEvent }
  | { kind: "message"; message: AgentMessageRow }
);
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
  progress,
  agentContext,
  agentError,
  messages = [],
  activities = [],
  call,
  captions,
  canvas,
  footer,
  empty,
  placeholder,
  status,
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
  progress?: AgentProgressData;
  agentContext?: Extract<ComponentProps<typeof AgentProgress>, { context: unknown }>["context"];
  agentError?: string;
  messages?: readonly AgentMessageRow[];
  activities?: readonly SubagentActivity[];
  call?: ReactNode;
  captions?: ReactNode;
  canvas?: ReactNode;
  footer?: ReactNode;
  empty?: ReactNode;
  placeholder?: string;
  status?: ComponentProps<typeof AgentShell>["status"];
  bodyClassName?: string;
  feedClassName?: string;
}) {
  const rows = useMemo(() => {
    const events: Row[] = context.events.flatMap((raw) => {
      const event = toAgentEvent(raw);
      if (!event || !renderers[event.type]) return [];
      return [
        {
          key: `event:${event.offset}`,
          at: event.createdAt,
          order: event.offset,
          offset: event.offset,
          kind: "event",
          event,
        },
      ];
    });
    return [
      ...events,
      ...messages.map((message): Row => ({
        key: message.key,
        at: message.createdAt,
        order: message.offset,
        kind: "message",
        message,
      })),
    ].toSorted(
      (a, b) =>
        a.at.localeCompare(b.at) ||
        a.kind.localeCompare(b.kind) ||
        a.order - b.order ||
        a.key.localeCompare(b.key),
    );
  }, [context.events, renderers, messages]);
  const render = useCallback(
    (row: Row) =>
      row.kind === "message" ? (
        <AgentMessage message={row.message} />
      ) : (
        renderers[row.event.type]?.(row.event, { onAppend })
      ),
    [renderers, onAppend],
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
          >
            <Feed
              rows={rows}
              renderRow={render}
              older={context.error ? undefined : context.older}
              empty={emptyContent}
              tail={
                <>
                  {rows.length === 0 ? emptyContent : null}
                  {progress ? (
                    <AgentProgress progress={progress} />
                  ) : agentContext ? (
                    <AgentProgress context={agentContext} error={agentError} />
                  ) : null}
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
