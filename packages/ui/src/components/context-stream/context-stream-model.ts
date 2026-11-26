import type { ReactNode } from "react";

export type ContextStreamActorKind = "person" | "guest" | "mind" | "context" | "app";

export type ContextStreamActorRef = {
  kind: ContextStreamActorKind;
  id: string;
  email?: string;
  name?: string;
};

export type ContextStreamActorIdentity = ContextStreamActorRef & {
  name: string;
  label: string;
  avatar?: string;
  status?: { text: string; until?: string };
  path?: string;
};

export type ContextStreamFileRef = {
  path: string;
  filename: string;
  contentType: string;
  size: number;
  width?: number;
  height?: number;
};

export type SubcontextPreview = {
  path: string;
  anchor: number;
  startedBy?: ContextStreamActorRef;
  title?: string;
  replies: number;
  participants: readonly ContextStreamActorRef[];
  unread?: boolean;
  more?: number;
  last?: { offset: number; at: string; by: ContextStreamActorRef; text: string };
  live?: { by: ContextStreamActorRef; text: string; since: string };
  ended?: { at: string; outcome: "done" | "failed" | "stopped" };
};

export type ContextStreamCopyItem = {
  label: string;
  value: string;
  mono?: boolean;
};

export type ContextStreamMenuAction = {
  label: string;
  onSelect: () => void;
};

/** Configurable 1-level-deep menu attached to a message's corner `•••` button.
 *  Keeps offsets, spans, and trace details off the 0-click surface while making them one tap away. */
export type ContextStreamMessageMenu = {
  /** Overview of how this message came to be (e.g. collapsed activity span, model calls, event range). */
  provenance?: ReactNode;
  /** Copyable values (defaults to copying the message text when omitted). */
  copyItems?: readonly ContextStreamCopyItem[];
  /** Extra actions (e.g. "Inspect full trace", "View raw events"). */
  actions?: readonly ContextStreamMenuAction[];
};

type BaseRow = {
  key: string;
  offset: number;
  at: number;
  by: ContextStreamActorRef;
  onBehalfOf?: ContextStreamActorRef;
  subcontexts?: readonly SubcontextPreview[];
};

export type ContextStreamMessageItem = BaseRow & {
  kind: "message";
  text: string;
  files?: readonly ContextStreamFileRef[];
  editedAt?: number;
  deleted?: true;
  reactions?: readonly { emoji: string; by: readonly ContextStreamActorRef[] }[];
  sending?: "pending" | "failed";
};

export type ContextStreamSubcontextItem = BaseRow & {
  kind: "subcontext";
  subcontext: SubcontextPreview;
};

export type ContextStreamCustomItem = BaseRow & {
  kind: `${string}/${string}`;
  data: unknown;
  span?: readonly [from: number, to: number];
};

export type ContextStreamDayItem = {
  kind: "day";
  key: string;
  at: number;
  label: string;
};

export type ContextStreamItem =
  | ContextStreamMessageItem
  | ContextStreamSubcontextItem
  | ContextStreamCustomItem
  | ContextStreamDayItem;

export type ContextStreamLiveEntry = {
  key: string;
  by: ContextStreamActorRef;
  kind: "typing" | `${string}/${string}`;
  text?: string;
  sinceMs?: number;
  data?: unknown;
  /** Optional 1-level-deep `•••` menu for an in-progress row (live offset range, running steps, inspect action). */
  menu?: ContextStreamMessageMenu;
};

export type ContextStreamOpenTarget =
  | { subcontext: string; anchor?: number }
  | { pane: string; data: unknown };

export function defaultActorIdentity(ref: ContextStreamActorRef): ContextStreamActorIdentity {
  const shortEmail = ref.email?.split("@", 1)[0];
  const rawName = ref.name || shortEmail || ref.id;
  const name = ref.kind === "guest" ? `${rawName} (guest)` : rawName;
  const baseLabel = ref.email || ref.name || ref.id;
  const label = ref.kind === "guest" ? `${baseLabel} (guest)` : baseLabel;
  return { ...ref, name, label };
}

export function actorFaceProps(actor: ContextStreamActorIdentity, agentName: string) {
  const isMind = actor.kind === "mind" || actor.kind === "context";
  const who = isMind && actor.name === agentName ? agentName : actor.email || actor.id;
  return {
    who,
    name: actor.email ? undefined : actor.name,
    agent: agentName,
    ...(isMind && { kind: "mind" as const }),
  };
}

export function formatShortTime(timestampMs: number): string {
  if (!Number.isFinite(timestampMs)) return "";
  return new Date(timestampMs).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** Compact gutter timestamp (`14:38`) revealed on hover for stacked continuation messages. */
export function formatGutterHoverTime(timestampMs: number): string {
  return formatShortTime(timestampMs);
}

/** Maximum gap (`10m`) within which consecutive messages from the same principal stack without repeating the header. */
const STACK_WINDOW_MS = 10 * 60_000;

/** Maximum child subcontext bars rendered inline under one parent item before `"+n more"`. */
export const MAX_INLINE_SUBCONTEXT_BARS = 2;

export function estimateContextStreamItemSize(
  item: ContextStreamItem,
  continuesRun = false,
): number {
  if (item.kind === "day") return 36;
  if (item.kind === "subcontext") return 40;
  if (item.kind === "message") {
    const bars = Math.min(item.subcontexts?.length ?? 0, MAX_INLINE_SUBCONTEXT_BARS);
    return (continuesRun ? 34 : 62) + bars * 32;
  }
  return 44;
}

/** Consecutive messages from the same actor within `STACK_WINDOW_MS` stack tightly without repeating
 *  the face or author header, restarting when another actor speaks, a non-message row intervenes,
 *  or the gap exceeds `STACK_WINDOW_MS`. */
export function computeContinuesRunFlags(items: readonly ContextStreamItem[]): boolean[] {
  return items.map((item, idx) => {
    if (idx === 0 || item.kind !== "message") return false;
    const prev = items[idx - 1]!;
    if (prev.kind !== "message") return false;
    if (prev.by.kind !== item.by.kind || prev.by.id !== item.by.id) return false;
    if (
      Number.isFinite(prev.at) &&
      Number.isFinite(item.at) &&
      item.at - prev.at > STACK_WINDOW_MS
    ) {
      return false;
    }
    return true;
  });
}
