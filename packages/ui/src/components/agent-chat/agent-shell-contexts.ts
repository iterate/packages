// What an agent's shell tells the parts under it, by React context, where a page draws Chat | Events
// in its own header (agent-strip.tsx says how the parts use them).
import { createContext } from "react";
import type { AgentShellStatus } from "./agent-strip.tsx";

/** `true` where the page draws Chat | Events in its own header: every `AgentShell` under it then
 *  draws no strip. The kind frame sets it when the page asks (`tabsInHeader` of its inputs). */
export const AgentTabsInHeader = createContext(false);

/** The status for the feed's foot, which the shell hands down when it draws no strip; `null`:
 *  the shell draws a strip, or there is no shell, and the foot has no status line. */
export const AgentFootStatusContext = createContext<{
  status: AgentShellStatus | undefined;
} | null>(null);
