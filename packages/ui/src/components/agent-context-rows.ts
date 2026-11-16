// agent-context-rows.ts — THE ROWS of `AgentContext`'s feed, as data: the host's rows from its own
// log, the messages from other agents, the agent's settled activities from the AGENT's log, and the
// lines said in a call, merged by time, with every run of spoken lines rolled up into one row.
// Plain functions, no React: agent-context.tsx draws these.
import type { StreamEvent } from "#/components/agent-chat/stream-event.ts";
import type { AgentMessageRow } from "#/components/agent-chat/agent-progress.ts";
import type { AgentUiActivity, AgentUiItem } from "#/components/agent-chat/agent-ui-reducer.ts";
import type { OlderPages } from "#/components/virtual-log/older-pages.ts";
import {
  rollUpSpokenLines,
  type SpokenLine,
  type SpokenRollupRow,
} from "#/components/call/spoken-lines.ts";

/** A row's place: `at`, an ISO time, then its kind, then `order`, then its key. `offset` is its
 *  place in the HOST's log, when it is one of that log's events. */
type Placed = { key: string; at: string; order: number; offset?: number };

/** A row before the rollup. */
export type PlacedRow = Placed &
  (
    | { kind: "event"; event: StreamEvent }
    | { kind: "message"; message: AgentMessageRow }
    | { kind: "activity"; activity: AgentUiActivity }
    | { kind: "said"; line: SpokenLine }
  );

/** A row of the feed: every row but a spoken line, and the rollups that hold those. */
export type AgentContextRow = Exclude<PlacedRow, { kind: "said" }> | SpokenRollupRow;

/** What the merge reads. `renderers` names the host's event types that are rows; `spokenLine`
 *  answers a line for an event that is a line said. */
export type RowSources = {
  events: readonly StreamEvent[];
  renderers: Readonly<Record<string, unknown>>;
  spokenLine?: ((event: StreamEvent) => SpokenLine | null) | undefined;
  messages: readonly AgentMessageRow[];
  activities: readonly AgentUiActivity[];
};

/** One time format for every kind, so the times sort as strings: a host's "…:00Z" and an
 *  activity's "…:00.000Z" are the same instant. A time that does not parse stays as it is. */
function isoOf(time: string) {
  const ms = Date.parse(time);
  return Number.isNaN(ms) ? time : new Date(ms).toISOString();
}

/** The settled activities of the agent's feed: the activity in flight is the progress line. */
export function settledActivities(items: readonly AgentUiItem[]): AgentUiActivity[] {
  return items.filter(
    (item): item is AgentUiActivity => item.kind === "activity" && item.status === "done",
  );
}

/** Every row, sorted by its place in time. Where each kind's `at` comes from:
 *  - `event` and `said`: the host's event's `createdAt`, its place in the host's log.
 *  - `message`: the message's `createdAt`.
 *  - `activity`: its `startedAtMs`, when the agent's first step began: after the line that asked
 *    for the work, before the agent's answer. */
export function placeRows({
  events,
  renderers,
  spokenLine,
  messages,
  activities,
}: RowSources): PlacedRow[] {
  const rows: PlacedRow[] = [];
  for (const event of events) {
    const place = { at: isoOf(event.createdAt), order: event.offset, offset: event.offset };
    const line = spokenLine?.(event);
    if (line) rows.push({ ...place, key: `said:${line.key}`, kind: "said", line });
    else if (renderers[event.type])
      rows.push({ ...place, key: `event:${String(event.offset)}`, kind: "event", event });
  }
  for (const message of messages)
    rows.push({
      key: message.key,
      at: isoOf(message.createdAt),
      order: message.offset,
      kind: "message",
      message,
    });
  for (const activity of activities)
    rows.push({
      key: `activity:${activity.id}`,
      at: new Date(activity.startedAtMs).toISOString(),
      order: activity.startedAtMs,
      kind: "activity",
      activity,
    });
  return rows.toSorted(
    (a, b) =>
      a.at.localeCompare(b.at) ||
      SOURCE_ORDER[a.kind] - SOURCE_ORDER[b.kind] ||
      a.order - b.order ||
      a.key.localeCompare(b.key),
  );
}

/** At one instant: the host's own rows first, in the order of its log (a typed line and a spoken
 *  line are both its events, so their offsets decide), then the agent's work, then the messages
 *  from other agents. */
const SOURCE_ORDER: Record<PlacedRow["kind"], number> = {
  event: 0,
  said: 0,
  activity: 1,
  message: 2,
};

/** The feed's rows: the placed rows, with every run of consecutive spoken lines as one rollup,
 *  named by the row before it (`rollUpSpokenLines`), so it keeps its key, and its open state, as
 *  lines are said and as older lines load. */
export function rolledUp(rows: readonly PlacedRow[]): readonly AgentContextRow[] {
  return rollUpSpokenLines(
    rows.map((row) =>
      row.kind === "said"
        ? {
            ...row.line,
            key: row.key,
            offset: row.line.offset ?? row.offset,
            kind: "said" as const,
          }
        : row,
    ),
  );
}

/** The agent's log pages apart from the host's: while the host's feed holds a row older than the
 *  agent's oldest held event, the work of that time is missing. True then, and while the agent's
 *  log has older pages; never when the host's log holds no row, or the agent's holds no event. */
export function agentLogTrailsHost(
  rows: readonly PlacedRow[],
  agentEvents: readonly StreamEvent[],
  agentOlder: OlderPages,
) {
  if (agentOlder.exhausted) return false;
  const hostOldest = rows.find((row) => row.kind === "event" || row.kind === "said")?.at;
  const agentOldest = agentEvents[0]?.createdAt;
  if (!hostOldest || !agentOldest) return false;
  return isoOf(agentOldest) > hostOldest;
}
