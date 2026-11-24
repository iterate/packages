// agent-traces.ts — THE TRACES' STATE, shared by every page that opens an agent's traces:
// `AgentChat` (agent-chat.tsx) and `AgentContext` (../agent-context.tsx). The patch that closes
// them, and whether the open one needs older pages of the agent's log.
import type { AgentChatState } from "./agent-chat-search.ts";
import type { Inspected } from "./agent-inspectors.tsx";
import type { StreamEvent } from "./stream-event.ts";
import type { OlderPages } from "#/components/virtual-log/older-pages.ts";

/** The patch that closes the chat's traces. */
export const TRACES_CLOSED: Partial<AgentChatState> = {
  llmRequest: undefined,
  scriptRun: undefined,
};

/** A trace reads what the chat does not: an LLM request's conversation is rebuilt along its chain
 *  of bases, which can stand below the pages held, and a link can name a run below them. */
export function traceWantsOlder(
  inspected: Inspected,
  older: OlderPages,
  events: readonly StreamEvent[],
) {
  if (older.exhausted) return false;
  if (inspected?.kind === "scriptRun")
    return inspected.requestOffset < (events[0]?.offset ?? Infinity);
  return inspected?.kind === "llmRequest";
}
