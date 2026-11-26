// How an agent looks in a list, the same in every list of them (agents-nav.tsx, the Dash's sidebar
// and palette, agents-home.tsx): its kind's icon, and its status's dot.
import { BotIcon, BoxIcon, SquareTerminalIcon } from "lucide-react";
import type { AgentStatus } from "#/lib/agent-summary.ts";

/** What runs the agent: iterate's own, a coding session, or something else. */
export function kindIcon(kind: string | null) {
  if (!kind || kind === "iterate" || kind === "agent") return BotIcon;
  if (kind === "claude" || kind === "codex" || kind === "opencode") return SquareTerminalIcon;
  return BoxIcon;
}

/** A status's dot: its colour alone. A dot that pulsed while its agent worked made the browser draw
 *  every frame for as long as any listed agent worked: hours, in every open Dash tab. */
export const STATUS_DOT: Record<AgentStatus, string> = {
  working: "bg-success",
  waiting: "bg-warning",
  idle: "bg-muted-foreground/60",
  ended: "border border-muted-foreground/60 bg-sidebar",
};
