// The agent chat's state as a URL's search: the tab, the open trace, and every choice of the Events
// tab's context view (`ContextViewState`, whose file says how a route uses a schema like this one).
import { z } from "zod";
import { ContextViewState } from "#/components/context-view/context-view-search.ts";

export const AgentChatState = ContextViewState.extend({
  /** The tab shown; omitted = the chat. */
  view: z.enum(["chat", "events"]).optional().catch(undefined),
  /** The LLM request whose trace is open, by its offset. */
  llmRequest: z.number().int().positive().optional().catch(undefined),
  /** The script run whose trace is open, by its `itx/run-requested` offset. */
  scriptRun: z.number().int().positive().optional().catch(undefined),
});

/** What `AgentChat` reads and patches. */
export type AgentChatState = z.infer<typeof AgentChatState>;
