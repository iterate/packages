// THE BRIDGE between a page that shows an agent (host.tsx) and the sandboxed frame that runs its
// kind's view (frame.tsx): capnweb over a MessagePort, a main object each way.
//
//   host → frame  `update(delta)`: what changed of the view's inputs since the last update. Events
//                 go as the pages added at either end, never the whole log again.
//   host → frame  `start(input)`: the kind's `newAgent.start`, for the Dash's New agent.
//   frame → host  `loaded(…)` once (what the live read should include), then the verbs: message,
//                 append, fileUrl, storeFiles, setState, loadOlder, and an MCP App's callTool and
//                 readResource. Each acts on the one agent the host shows;
//                 the host never hands over its context stub, whose `invoke` and `cd` reach the
//                 whole mind.
import type { AgentChatState } from "../components/agent-chat/agent-chat-search.ts";
import type { ContextViewSource } from "../components/context-view/context-view.tsx";
import type { AgentKindNewAgent, AgentKindViewProps } from "./types.ts";

type Event = ContextViewSource["events"][number];

/** The first message, host → frame, carrying the port. `source` is the kind file's text, or
 *  `null` when the agent's kind has none. */
export type AgentKindViewHello = {
  type: "iterate/agent-kind-view";
  name: string;
  source: string | null;
};
/** The frame's script has run and is listening for the hello. */
export const AGENT_KIND_VIEW_READY = "iterate/agent-kind-view-ready";

/** Everything a view's props are built from, as plain data. */
export type AgentKindViewInputs = {
  path: string;
  events: readonly Event[];
  caughtUp: boolean;
  error: string | undefined;
  head: number | undefined;
  /** Reading older pages: `null` when the whole log is held. */
  older: { loading: boolean; exhausted: boolean } | null;
  processors: AgentKindViewProps["context"]["processors"];
  presence: ContextViewSource["presence"];
  liveState: ContextViewSource["liveState"];
  /** The version of the agent's path that `events` are of, once a read has said it (`versionOf`). */
  version: number | undefined;
  hostError: string | undefined;
  state: AgentChatState;
  /** The page's `<html>` classes (its theme), for the frame's own. */
  documentClass: string;
  /** `true`: the page draws Chat | Events in its own header, and the tab is `state.view`: the
   *  view's shell draws no strip, and its status is a line at the feed's foot. */
  tabsInHeader?: boolean;
  /** The viewer's actor id, when the page knows it (`AgentKindViewProps.me`). */
  me?: string;
  /** `true`: the page shows who else is here (`AgentKindViewProps.presence`). */
  presenceOn?: boolean;
};

/** What changed: the fields that did, and the events added at either end, or all of them again
 *  when the held window moved otherwise (a reconnect). */
export type AgentKindViewUpdate = Partial<Omit<AgentKindViewInputs, "events">> & {
  events?: { reset: Event[] } | { prepend: Event[]; append: Event[] };
};

/** What a kind file says of how its agents start (types.ts `AgentKindNewAgent`), as data: its
 *  `start` runs in the frame (`AgentKindViewFrameApi.start`). */
export type AgentKindNewAgentSummary = Omit<AgentKindNewAgent, "start" | "describe">;

/** What the frame reports once it has read the kind file. */
export type AgentKindViewLoaded =
  | { ephemeralEvents: string[]; newAgent?: AgentKindNewAgentSummary }
  | { error: string }
  /** The agent's kind has no file: the frame shows the Events tab. */
  | { none: true };

export interface AgentKindViewHostApi {
  loaded(result: AgentKindViewLoaded): void;
  message(input: Parameters<AgentKindViewProps["onMessage"]>[0]): Promise<void>;
  append(events: unknown[]): Promise<void>;
  fileUrl(path: string): Promise<string>;
  storeFiles(
    files: Parameters<NonNullable<AgentKindViewProps["storeFiles"]>>[0],
    key?: string,
  ): ReturnType<NonNullable<AgentKindViewProps["storeFiles"]>>;
  setState(patch: Partial<AgentChatState>): void;
  loadOlder(): void;
  /** An MCP App's tool call, made as the agent at `path` (the host's own agent alone). */
  callTool(
    call: Parameters<NonNullable<AgentKindViewProps["widgetCalls"]>["callTool"]>[0],
  ): Promise<unknown>;
  /** An MCP App's resource read, likewise. */
  readResource(
    read: Parameters<NonNullable<AgentKindViewProps["widgetCalls"]>["readResource"]>[0],
  ): Promise<unknown>;
}

export interface AgentKindViewFrameApi {
  update(update: AgentKindViewUpdate): void;
  /** The kind's `newAgent.start(input)`, run in the frame: the events that start an agent of the
   *  kind at `input.path`. The page appends them; the kind file never runs in the page. */
  start(input: Parameters<AgentKindNewAgent["start"]>[0]): unknown[] | Promise<unknown[]>;
}

/** The update from `previous` (what the frame holds) to `next`, or `null` when nothing changed. */
export function updateBetween(
  previous: AgentKindViewInputs | undefined,
  next: AgentKindViewInputs,
): AgentKindViewUpdate | null {
  const update: AgentKindViewUpdate = {};
  let changed = false;
  for (const key of Object.keys(next) as (keyof AgentKindViewInputs)[]) {
    if (key === "events" || (previous && previous[key] === next[key])) continue;
    (update as Record<string, unknown>)[key] = next[key];
    changed = true;
  }
  if (!previous || previous.events !== next.events) {
    update.events = eventsBetween(previous?.events || [], next.events);
    changed = true;
  }
  return changed ? update : null;
}

/** The pages added at either end of what was held, or everything when it moved otherwise. */
function eventsBetween(
  held: readonly Event[],
  next: readonly Event[],
): AgentKindViewUpdate["events"] {
  const first = held[0];
  const last = held.at(-1);
  if (!first || !last) return { reset: [...next] };
  const start = next.findIndex((event) => event.offset === first.offset);
  const end = start + held.length - 1;
  if (start < 0 || next[end]?.offset !== last.offset) return { reset: [...next] };
  return { prepend: next.slice(0, start), append: next.slice(end + 1) };
}

/** `held` with `update` applied. */
export function applyUpdate(
  held: AgentKindViewInputs | undefined,
  update: AgentKindViewUpdate,
): AgentKindViewInputs {
  const { events: change, ...fields } = update;
  const events = !change
    ? held?.events || []
    : "reset" in change
      ? change.reset
      : [...change.prepend, ...(held?.events || []), ...change.append];
  return { ...(held as AgentKindViewInputs), ...fields, events };
}
