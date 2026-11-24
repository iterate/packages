// The agent's log as the agent-UI reducer (agent-ui-reducer.ts) reads it: `reduceAgentUi`
// folds every committed event, the agent's and the context's script runs (`itx/run-requested` /
// `itx/run-settled`, identified by the request's offset) alike, into messages and activities (an
// LLM step that wrote a script, the code step that ran it, grouped into rounds). The fold reads
// the current version of the path alone (`foldAgentLog`).
import { z } from "zod";
import { RunRequested, RunSettled, type RunSettlement } from "iterate/stream/run";
import { sliceText, type StreamText } from "./chunked-text.ts";
import { AGENT_FACT, scriptCallOf } from "./agent-facts.ts";
import {
  initialAgentUiState,
  reduceAgentUi,
  settleAgentUiAtIdleBoundary,
  withoutRunningRequests,
  type AgentUiItem,
  type AgentUiState,
  type AgentUiStep,
} from "./agent-ui-reducer.ts";
import type { StreamEvent } from "./stream-event.ts";

// Loose: the Events view is the raw log, so every envelope field the wire carries survives.
const Committed = z.looseObject({
  offset: z.number().int().positive(),
  type: z.string(),
  createdAt: z.string(),
  payload: z.unknown().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  idempotencyKey: z.string().optional(),
});

/** A row of the log as the reducer's `StreamEvent`, or null when it is not a committed row. */
export function toAgentEvent(raw: unknown): StreamEvent | null {
  const parsed = Committed.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** THE BORDER OF A VERSION. `itx.cd(path).newVersion()` starts a path over: its log goes on, and
 *  this fact ends the earlier version (the next fact, `itx/created`, names the new version). The
 *  facts at lower offsets are another conversation. */
const VERSION_ENDED = "events.iterate.com/itx/version-ended";

/** The log folded so far, which the next call goes on from. */
export type AgentLogFold = {
  /** The rows folded, as the caller's array held them: how the next call tells what grew. */
  log: readonly unknown[];
  /** The committed events of the current version, in offset order. */
  events: readonly StreamEvent[];
  state: AgentUiState;
  items: readonly AgentUiItem[];
  /** The offset of the newest `itx/version-ended` held, or null: the current version starts after
   *  it, and the chat reads no page older than it. */
  versionEndedAt: number | null;
};

const NOTHING_FOLDED: AgentLogFold = {
  log: [],
  events: [],
  state: initialAgentUiState(),
  items: [],
  versionEndedAt: null,
};

/** `log`, sorted by offset, folded through the reducer: on from `held` when the log only grew at its
 *  end, so a live tail costs what arrived; from the start otherwise (an older page). Either way a
 *  settled row keeps its identity, so a memoised row skips the re-render that a streamed frame or an
 *  older page would bring and its markdown is not parsed again. ONLY THE CURRENT VERSION is folded:
 *  the events after the newest `itx/version-ended` held. The feed, the live line and the traces
 *  read this fold, so they agree. */
export function foldAgentLog(
  held: AgentLogFold | undefined,
  log: readonly unknown[],
): AgentLogFold {
  const grewAtEnd =
    held &&
    held.log.length > 0 &&
    log[0] === held.log[0] &&
    log[held.log.length - 1] === held.log.at(-1);
  const from = grewAtEnd ? held : NOTHING_FOLDED;
  const arrived = log.slice(from.log.length).flatMap((row) => toAgentEvent(row) ?? []);
  const border = arrived.findLast((event) => event.type === VERSION_ENDED);
  // a border starts the fold over after it: the facts at lower offsets are another version's
  const start = border ? { ...NOTHING_FOLDED, versionEndedAt: border.offset } : from;
  const fresh = border ? arrived.slice(arrived.indexOf(border) + 1) : arrived;
  let { state } = start;
  const items: AgentUiItem[] = [];
  for (const event of fresh) {
    const reduced = reduceAgentUi(state, event);
    state = reduced.endState;
    items.push(...reduced.items);
  }
  const rows = inRuns(items);
  return {
    log,
    events: fresh.length > 0 ? start.events.concat(fresh) : start.events,
    state,
    items:
      rows.length > 0
        ? grewAtEnd && !border
          ? goingOn(start.items, rows)
          : keepingHeldMessages(rows, held?.items)
        : start.items,
    versionEndedAt: start.versionEndedAt,
  };
}

/** `items` with each run of inputs that started no turn joined into its first one's row. */
function inRuns(items: readonly AgentUiItem[]) {
  const rows: AgentUiItem[] = [];
  for (const item of items) {
    const last = rows.at(-1);
    if (item.kind === "background" && last?.kind === "background")
      last.messages.push(...item.messages);
    else rows.push(item.kind === "background" ? { ...item, messages: [...item.messages] } : item);
  }
  return rows;
}

/** `rows` after `held`, where a run that ends `held` goes on: its row keeps its id as it grows. */
function goingOn(held: readonly AgentUiItem[], rows: readonly AgentUiItem[]) {
  const last = held.at(-1);
  const [first, ...rest] = rows;
  if (last?.kind !== "background" || first?.kind !== "background") return held.concat(rows);
  const grown = { ...last, messages: [...last.messages, ...first.messages] };
  return [...held.slice(0, -1), grown, ...rest];
}

/** `items`, with each message that `held` has as the object `held` has. A message is one event, so
 *  the same id is the same words; an activity can gain steps from an older page, so it is new, and a
 *  run of inputs is the same only at the same length. */
function keepingHeldMessages(items: AgentUiItem[], held: readonly AgentUiItem[] = []) {
  const heldById = new Map(held.map((item) => [item.id, item]));
  return items.map((item) => {
    const kept = heldById.get(item.id);
    if (!kept || item.kind === "activity") return item;
    const grown =
      item.kind === "background" &&
      kept.kind === "background" &&
      item.messages.length !== kept.messages.length;
    return grown ? item : kept;
  });
}

/** The feed a fold shows, given what the agent facet says of the turn. When no request can be open,
 *  one still running in the log never opened. With the facet `idle`, the turn boundary flushes what
 *  waits behind an activity whose every step has settled. */
export function agentFeedOf(
  fold: AgentLogFold,
  idle: boolean,
  requestMayBeOpen = true,
): { state: AgentUiState; items: readonly AgentUiItem[] } {
  const state = requestMayBeOpen ? fold.state : withoutRunningRequests(fold.state);
  if (!idle) return { state, items: fold.items };
  const settled = settleAgentUiAtIdleBoundary(state);
  const items = settled.items.length > 0 ? goingOn(fold.items, inRuns(settled.items)) : fold.items;
  return { state: settled.endState, items };
}

/** The whole feed from the log, folded from its first row. */
export function reduceAgentFeed(
  events: readonly StreamEvent[],
  idle: boolean,
  requestMayBeOpen?: boolean,
) {
  return agentFeedOf(foldAgentLog(undefined, events), idle, requestMayBeOpen);
}

/** The model's own code inside the agent's envelope (core/configs/default agent/script-envelope.ts
 *  wraps it between these markers), or null for a script that has no envelope. */
export function authoredScript(code: string): string | null {
  const open = "//#region your script";
  const start = code.indexOf(open);
  const end = code.lastIndexOf("//#endregion your script");
  if (start === -1 || end < start) return null;
  return code.slice(start + open.length, end).trim();
}

// ── display formatters ──

/** CLI-style elapsed clock for the live phase indicator: one decimal, no space (`0.9s`, `12.3s`). */
export function formatElapsedSeconds(durationMs: number): string {
  return `${(Math.max(0, durationMs) / 1000).toFixed(1)}s`;
}

export function formatClockTime(timestampMs: number): string {
  return new Date(timestampMs).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function formatDateTime(timestampMs: number): string {
  return new Date(timestampMs).toLocaleString([], { dateStyle: "medium", timeStyle: "medium" });
}

export function formatFileSize(size: number): string {
  if (size < 1024) return `${String(size)} B`;
  const kilobytes = size / 1024;
  if (kilobytes < 1024) return `${kilobytes.toFixed(1).replace(/\.0$/, "")} KB`;
  return `${(kilobytes / 1024).toFixed(1).replace(/\.0$/, "")} MB`;
}

const CODE_START_PATTERN = /^\s*(async|await|function|const|let|import)\b/;
const CODEMODE_TAG_PATTERN = /^[ \t]*<codemode(\s|>)/m;
/** A codemode answer renders as code; prose renders as markdown. */
export function looksLikeCode(text: StreamText): boolean {
  const prefix = typeof text === "string" ? text : sliceText(text, 0, 4096);
  return (
    prefix.includes("```") || CODE_START_PATTERN.test(prefix) || CODEMODE_TAG_PATTERN.test(prefix)
  );
}

/** What the live activity is doing, from its running steps. */
export function liveActivityLabel(runningSteps: readonly AgentUiStep[]): string {
  if (runningSteps.some((step) => step.kind === "code")) return "Running code";
  const llm = runningSteps.findLast((step) => step.kind === "llm");
  if (!llm) return "Working…";
  if (llm.kind === "llm" && llm.responseText.length > 0) return "Writing code";
  // the provider says the model reasons, or reasoning words have arrived
  if (llm.kind === "llm" && (llm.thinking || llm.thinkingText.length > 0)) return "Thinking";
  return "Waiting for a response";
}

/** The items a request of the agent adds to the conversation: a script's result is one of them. */
const RequestItems = z.object({
  itemsAdded: z.array(
    z.looseObject({
      atOffset: z.number().optional(),
      rank: z.number().optional(),
      tag: z.string().optional(),
      text: z.string(),
    }),
  ),
});

type ScriptTrace = {
  requestOffset: number;
  code: string;
  requestedAtMs: number;
  settlement?: { atMs: number; value: RunSettlement };
  /** What the model was told of the outcome: the script's result as a later request of the agent
   *  gives it. */
  seen?: string;
};

/** One script run by its `itx/run-requested` offset: the code, its `itx/run-settled`, and the
 *  result a later request gave the model. The agent places that result at the request whose
 *  response wrote the script, after the response (`rank` 1 is its first script): the run's key
 *  names both (agent-facts.ts). */
export function scriptTrace(
  events: readonly StreamEvent[],
  requestOffset: number,
): ScriptTrace | null {
  const requested = events.find(
    (event) =>
      event.offset === requestOffset && event.type === "events.iterate.com/itx/run-requested",
  );
  const request = RunRequested.safeParse(requested?.payload);
  if (!requested || !request.success) return null;
  const [settlement] = events.flatMap((event) => {
    if (event.type !== "events.iterate.com/itx/run-settled") return [];
    const settled = RunSettled.safeParse(event.payload);
    return settled.success && settled.data.requestOffset === requestOffset
      ? [{ atMs: Date.parse(event.createdAt), value: settled.data.settlement }]
      : [];
  });
  const call = scriptCallOf(requested.idempotencyKey);
  const [seen] = call
    ? events.flatMap((event) => {
        if (event.type !== AGENT_FACT.llmRequested) return [];
        const asked = RequestItems.safeParse(event.payload);
        if (!asked.success) return [];
        const result = asked.data.itemsAdded.find(
          (item) =>
            item.tag === "script-result" &&
            item.atOffset === call.requestOffset &&
            item.rank === 1 + call.index,
        );
        return result ? [result.text] : [];
      })
    : [];
  return {
    requestOffset,
    code: request.data.code,
    requestedAtMs: Date.parse(requested.createdAt),
    settlement,
    seen,
  };
}
