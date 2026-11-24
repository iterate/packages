/** Safe conversation data for a host that keeps the agent's raw log on its server. */
import { AgentEventCatalog } from "iterate/agents/contract";
import { foldAgentLog, toAgentEvent } from "./agent-events.ts";
import { deriveAgentUiLiveStatus, isAgentUiLiveRowWorking } from "./agent-ui-reducer.ts";
import type { AgentRow } from "#/lib/agent-summary.ts";

export type AgentProgressData = { text: string; working: boolean; activity: string | null };
export type AgentMessageRow = {
  key: string;
  offset: number;
  createdAt: string;
  from: string;
  text: string;
};
export type SubagentActivity = {
  path: string;
  title: string;
  activity: string | null;
  status: "working" | "waiting";
};

/** Journal observations only. A host with live facet state can use AgentProgress's context form. */
export function agentProgressOf(events: readonly unknown[]): AgentProgressData {
  const { state } = foldAgentLog(undefined, events);
  if (state.paused) return { text: "Paused", working: false, activity: null };
  const status = deriveAgentUiLiveStatus(state);
  if (!status || !isAgentUiLiveRowWorking(state))
    return { text: "Idle", working: false, activity: null };
  const labels = {
    working: "Working…",
    waiting: "Waiting for the model",
    thinking: "Thinking",
    writing: "Writing a response",
    running: "Running a script",
    processing: "Processing the result",
  };
  return { text: labels[status.phase], working: true, activity: status.statusText };
}

/** Explicit messages to the agent, with the sender context stamped by the collection. */
export function agentMessagesOf(events: readonly unknown[]): AgentMessageRow[] {
  return events.flatMap((raw) => {
    const event = toAgentEvent(raw);
    if (event?.type !== "events.iterate.com/agent/message-received") return [];
    const payload = AgentEventCatalog.events[
      "events.iterate.com/agent/message-received"
    ].payloadSchema.safeParse(event.payload);
    if (!payload.success || !payload.data.from) return [];
    return [
      {
        key: `agent-message:${event.offset}`,
        offset: event.offset,
        createdAt: event.createdAt,
        from: payload.data.from,
        text: payload.data.message,
      },
    ];
  });
}

/** The host filters the catalog to the agents this conversation may see before calling this. */
export function subagentActivitiesOf(rows: readonly AgentRow[]): SubagentActivity[] {
  return rows
    .flatMap((row) => {
      if (row.status !== "working" && row.status !== "waiting") return [];
      return [
        {
          path: row.path,
          title: row.title || row.path,
          activity: row.activity,
          status: row.status,
        },
      ];
    })
    .toSorted((a, b) => a.path.localeCompare(b.path));
}
