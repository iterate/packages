// THE AGENT'S LOG, FOR TESTS: one function per fact of the mind's own agent (the chat names them
// in agent-chat/agent-facts.ts; core/configs/default/agent/contract.ts lists them all), so a test
// writes a conversation in the agent's own facts. Each fact stands on the agent's path, committed
// at second `offset` of one minute (`timeOf`). The agent's own tests name the same facts
// (core/configs/default/agent-tests/test-support.mjs).
import type { RunSettlement } from "iterate/stream/run";
import type { AgentLiveState, StoredFile } from "#/components/agent-chat/agent-facts.ts";
import type { StreamEvent } from "#/components/agent-chat/stream-event.ts";
import type { ContextViewEvent } from "#/components/context-view/types.tsx";

/** A committed fact as the reducer reads it and as the chat's context holds it. */
export type LoggedEvent = StreamEvent & ContextViewEvent;

/** The agent's path. */
export const PATH = "/agents/people/ada/agent/x";
/** A person's stamp: Ada, appending through her own session. */
export const ADA = { origin: PATH, principal: { actor: "usr_1", email: "ada@example.com" } };
/** The mind's own code, which transcribes a channel's words for the model. */
export const MIND = { origin: "/" };
/** The agent's processor. */
const AGENT = { origin: PATH, processor: { slug: "agent", version: "3" } };
/** A script of the agent's response, which appends on the agent's path. */
const SCRIPT = { origin: PATH };

type Source = LoggedEvent["source"];
type LlmRequestPolicy = { behaviour: "dont-trigger-request" | "interrupt-current-request" };

/** When the fact at `offset` was committed, in epoch milliseconds. */
export function timeOf(offset: number) {
  return Date.UTC(2026, 10, 23, 12, 0, offset);
}

/** A committed fact of the agent's log. `type` leaves out `events.iterate.com/`. */
export function fact(
  offset: number,
  type: string,
  payload: object,
  source: Source = AGENT,
  more: Partial<LoggedEvent> = {},
): LoggedEvent {
  return {
    offset,
    type: `events.iterate.com/${type}`,
    createdAt: new Date(timeOf(offset)).toISOString(),
    path: PATH,
    payload,
    source,
    ...more,
  };
}

/** A person's words as the agent's one input (`agent/context-added`, role `user`), which start a
 *  request unless `llmRequestPolicy` says otherwise. */
export function said(
  offset: number,
  words: string,
  {
    source = ADA,
    files,
    llmRequestPolicy,
  }: { source?: Source; files?: StoredFile[]; llmRequestPolicy?: LlmRequestPolicy } = {},
): LoggedEvent {
  return fact(
    offset,
    "agent/context-added",
    { role: "user", content: words, files, llmRequestPolicy },
    source,
  );
}

/** Words that start no request: the agent reads them with the next one. */
export function quiet(offset: number, words: string, source: Source = ADA): LoggedEvent {
  return said(offset, words, { source, llmRequestPolicy: { behaviour: "dont-trigger-request" } });
}

/** A press of Interrupt, as the chat appends it under `source`'s stamp. */
export function interrupt(offset: number, source: Source = ADA): LoggedEvent {
  return fact(
    offset,
    "agent/context-added",
    {
      role: "developer",
      content: "The user interrupted the in-progress response from the web chat.",
      llmRequestPolicy: { behaviour: "interrupt-current-request" },
    },
    source,
  );
}

/** The Dash's words to the agent (`agent-ui/message-received`): the bubble. */
export function uiMessage(
  offset: number,
  words: string,
  { source = ADA, files }: { source?: Source; files?: StoredFile[] } = {},
): LoggedEvent {
  return fact(
    offset,
    "agent-ui/message-received",
    { message: words, client: "web", files },
    source,
  );
}

/** The mind's transcription of the raw fact at `raw` on the agent's path, for the model. */
export function transcription(
  offset: number,
  raw: number,
  words: string,
  { files, llmRequestPolicy }: { files?: StoredFile[]; llmRequestPolicy?: LlmRequestPolicy } = {},
): LoggedEvent {
  return fact(
    offset,
    "agent/context-added",
    { role: "user", content: words, source: { path: PATH, offset: raw }, files, llmRequestPolicy },
    MIND,
  );
}

/** What `itx.agents.get(path).message()` appends (`agent/message-received`), by default for Ada
 *  through the agents API. */
export function apiMessage(
  offset: number,
  words: string,
  {
    source = { origin: "/agents", onBehalfOf: { principal: ADA.principal } },
    ...payload
  }: { source?: Source; from?: string; files?: StoredFile[]; trigger?: false } = {},
): LoggedEvent {
  return fact(offset, "agent/message-received", { message: words, ...payload }, source);
}

/** A request of the agent (`llm-request/requested`): its offset is its identity. `itemsAdded` are
 *  the conversation's items it adds, such as a script's result (`scriptResult`). */
export function request(
  offset: number,
  {
    model = "m",
    purpose = "answer",
    itemsAdded = [],
  }: { model?: string; purpose?: string; itemsAdded?: object[] } = {},
): LoggedEvent {
  return fact(offset, "llm-request/requested", { model, purpose, extends: null, itemsAdded });
}

/** The item that gives the model the result of the `index`th script of the response to the request
 *  at `llmRequestOffset`, as a later request adds it. */
export function scriptResult(llmRequestOffset: number, text: string, index = 0) {
  return {
    atOffset: llmRequestOffset,
    rank: 1 + index,
    tag: "script-result",
    role: "developer",
    text: `Result of script ${String(index + 1)}:\n${text}`,
  };
}

/** A streamed window of the answer to the request at `llmRequestOffset`. Ephemeral. */
export function frame(
  offset: number,
  llmRequestOffset: number,
  window: {
    textDelta?: string;
    thinkingDelta?: string;
    thinking?: boolean;
    attempt?: number;
    sequence?: number;
  },
): LoggedEvent {
  return fact(offset, "llm-request/response-frame-received", {
    llmRequestOffset,
    attempt: 0,
    sequence: 0,
    textDelta: "",
    thinkingDelta: "",
    thinking: false,
    ...window,
  });
}

/** The one terminal fact of the request at `llmRequestOffset`. */
export function settled(
  offset: number,
  llmRequestOffset: number,
  result: object = succeeded("…"),
  more: { durationMs?: number } = {},
): LoggedEvent {
  return fact(offset, "llm-request/settled", { llmRequestOffset, attempt: 0, ...more, result });
}

/** A request that succeeded with `text`. */
export function succeeded(text: string, usage?: { inputTokens: number; outputTokens: number }) {
  return { status: "succeeded", text, providerItems: [], usage };
}

/** A request that failed. */
export function failed(errorMessage: string) {
  return { status: "failed", errorMessage, failureKind: "provider" };
}

/** A request that was cancelled, with what it had written by then. */
export function cancelled(reason: string, partialText?: string) {
  return { status: "cancelled", reason, partialText };
}

/** The run of the `index`th script of the response to the request at `llmRequestOffset`, as the
 *  agent asks the context for it. Null: a run that no response of the agent wrote. */
export function runRequested(
  offset: number,
  llmRequestOffset: number | null,
  code = "await work()",
  index = 0,
): LoggedEvent {
  return fact(offset, "itx/run-requested", { code }, AGENT, {
    idempotencyKey:
      llmRequestOffset === null
        ? undefined
        : `agent/script-run:${String(llmRequestOffset)}/${String(index)}`,
  });
}

/** The context's settlement of the run requested at `runOffset`. */
export function runSettled(
  offset: number,
  runOffset: number,
  settlement: RunSettlement = { status: "succeeded" },
): LoggedEvent {
  return fact(offset, "itx/run-settled", { requestOffset: runOffset, settlement }, SCRIPT);
}

/** The agent's words for a person (`agent-ui/message-sent`): a script of its response appends
 *  them. */
export function sent(offset: number, words: string): LoggedEvent {
  return fact(offset, "agent-ui/message-sent", { message: words }, SCRIPT);
}

/** The agent's summary line (`agent/summary-updated`), as its script sets it. */
export function summary(offset: number, activity: string): LoggedEvent {
  return fact(offset, "agent/summary-updated", { activity }, SCRIPT);
}

/** The agent pauses: it asks for no request until it resumes. */
export function paused(offset: number, reason?: string): LoggedEvent {
  return fact(offset, "agent/paused", { reason });
}

/** The agent resumes. */
export function resumed(offset: number, reason?: string): LoggedEvent {
  return fact(offset, "agent/resumed", { reason });
}

/** The border of a version: `itx.cd(path).newVersion()` ends `version` here, and the next fact,
 *  `itx/created`, starts the next one. */
export function versionEnded(offset: number, version: number): LoggedEvent {
  return fact(offset, "itx/version-ended", { version, held: {} }, { origin: PATH, platform: true });
}

/** The start of `version` of the agent's path. */
export function created(offset: number, version: number): LoggedEvent {
  return fact(offset, "itx/created", { path: PATH, version }, { origin: PATH, platform: true });
}

/** The agent's live state (the facet `agent`), with nothing open but what `state` names. */
export function liveState(state: Partial<AgentLiveState> = {}): AgentLiveState {
  return { paused: null, llmRequests: [], pendingTriggerOffsets: [], scriptCalls: [], ...state };
}
