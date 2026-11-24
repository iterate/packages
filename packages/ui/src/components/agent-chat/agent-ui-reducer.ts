import { RUN_DEADLINE_MS, RunRequested, RunSettled } from "iterate/stream/run";
import { z } from "zod";
import { appendText, sliceText, type StreamText } from "./chunked-text.ts";
import { AGENT_FACT, scriptRequestOffsetOf } from "./agent-facts.ts";
import {
  saidByOf,
  senderOf,
  sentByMe,
  type MessageSender,
  type StreamEvent,
} from "./stream-event.ts";

// The agent UI is a clean chat: user message → activity ("Ran code 2× · 3
// requests · 7.4 s") → assistant message, with pause and resume dividers, and
// what reached the agent without starting a turn folded out of the way.
// Reduced from the agent's facts (agent-facts.ts): settled items, plus the
// in-flight activity and its streamed text. Only a durable fact closes a step:
// `llm-request/settled` a model call, the context's `itx/run-settled` a script
// (the platform settles every run, `deadline` or `interrupted` included).
//
// The fold's memory is one turn long: once a turn is over `live` and the held
// messages are empty, and the rest only stamps later rows. So folding from any
// offset gives the rows folding from the first event gives, from the first turn
// that starts after that offset on. The chat relies on this to read the newest
// page of a log and older pages on request.

/** Why a request stopped short: an input interrupted it, another response answered its inputs
 *  first, or it ran past its deadline. */
const AgentLlmRequestCancelReason = z.enum(["interrupted-by-user-input", "superseded", "expired"]);
type AgentLlmRequestCancelReason = z.infer<typeof AgentLlmRequestCancelReason>;

export type AgentUiLlmStep = {
  kind: "llm";
  id: string;
  /** Offset of the `llm-request/requested` fact this step tracks. */
  llmRequestOffset: number;
  status: "running" | "done";
  model?: string;
  /** Streamed reasoning summary ("thinking") text. */
  thinkingText: StreamText;
  /** Streamed response text: the model's words and its `<codemode>` script. */
  responseText: StreamText;
  /** The provider says the model reasons now, with words or with none (the agent's
   *  `llm-request/response-frame-received` `thinking`). */
  thinking?: boolean;
  /** Which attempt of the request the streamed text is from (absent: 0): the next attempt after
   *  one failed part way replaces it. */
  attempt?: number;
  /** True once the agent asked to run the response's script (its `itx/run-requested` names this
   *  request). The script is then the story: pretty rendering collapses the raw response text
   *  behind the raw toggles. */
  interpreted?: boolean;
  inputTokens?: number;
  outputTokens?: number;
  durationMs?: number;
  /** When its settlement landed. */
  endedAtMs?: number;
  outcome?: "completed" | "failed" | "cancelled";
  /** Why a cancelled request stopped, when the UI recognizes the reason. */
  cancelReason?: AgentLlmRequestCancelReason;
  /** Who stopped it, when a principal's words or their press of Interrupt did: the platform's
   *  stamp on the input that carried the interrupt. Anyone in a shared conversation may stop any
   *  answer, so the feed says who did. */
  interruptedBy?: MessageSender;
  errorMessage?: string;
  startedAtMs: number;
};

export type AgentUiCodeStep = {
  kind: "code";
  id: string;
  /** Offset of the `itx/run-requested` event: the run's identity, which its
   * `itx/run-settled` names back. */
  requestOffset: number;
  status: "running" | "done";
  code: string;
  result?: unknown;
  errorMessage?: string;
  durationMs?: number;
  /** When its settlement landed. */
  endedAtMs?: number;
  success?: boolean;
  startedAtMs: number;
  /** When the platform gives up on the run and settles it `deadline`: the
   * request's time plus RUN_DEADLINE_MS. */
  deadlineAtMs: number;
  /**
   * The agent's summary `activity` line as of this step (the latest
   * agent/summary-updated fold when the step settled — scripts usually append
   * it mid-run). Round headers show this instead of a bare start time.
   */
  activitySummary?: string;
  /** True once this running script sent a message, which went out at once
   * (see emitAssistantMessageItem): nothing is held for its settle to release. */
  repliedAtOnce?: boolean;
};

export type AgentUiStep = AgentUiLlmStep | AgentUiCodeStep;

export type AgentUiActivity = {
  kind: "activity";
  id: string;
  status: "running" | "done";
  steps: AgentUiStep[];
  startedAtMs: number;
  endedAtMs?: number;
};

export type AgentUiActivitySummary = {
  codeCount: number;
  requestCount: number;
  outcome: "clean" | "interrupted" | "failed";
  interruptedWithPartialResponse: boolean;
  /** Who stopped the answer, when the log says (the newest interrupt of the activity). */
  interruptedBy?: MessageSender;
};

/** One canonical interpretation of activity attempts for every UI surface. */
export function summarizeAgentUiActivity(
  activity: AgentUiActivity,
  steps: readonly AgentUiStep[] = activity.steps,
): AgentUiActivitySummary {
  let codeCount = 0;
  let requestCount = 0;
  let failed = false;
  let interrupted = false;
  let interruptedWithPartialResponse = false;
  let interruptedBy: MessageSender | undefined;

  for (const step of steps) {
    if (step.kind === "code") {
      codeCount += 1;
      failed ||= step.success === false;
      continue;
    }

    requestCount += 1;
    const cancelled = step.outcome === "cancelled";
    if (cancelled && step.cancelReason === "interrupted-by-user-input") {
      interrupted = true;
      // the newest interrupt says who stopped the answer, also when code sent it and names nobody
      interruptedBy = step.interruptedBy;
      interruptedWithPartialResponse ||=
        step.thinkingText.length > 0 || step.responseText.length > 0;
    } else if (cancelled && step.cancelReason === "superseded") {
      // another response answered the same inputs first: the round goes on with that one
    } else if (step.outcome === "failed" || cancelled) {
      // Any other cancellation (expired, or a reason this UI doesn't recognize) means the
      // request produced nothing.
      failed = true;
    }
  }

  const outcome: AgentUiActivitySummary["outcome"] = failed
    ? "failed"
    : interrupted
      ? "interrupted"
      : "clean";
  return {
    codeCount,
    requestCount,
    outcome,
    interruptedWithPartialResponse,
    interruptedBy,
  };
}

/** Shared collapsed copy, parameterized only by a surface-specific interaction hint. */
export function formatAgentUiActivitySummary(
  activity: AgentUiActivity,
  options: {
    summary?: AgentUiActivitySummary;
    interruptedPartialHint?: string;
    /** The viewer's address or actor id: their own interrupt reads "by you". */
    me?: string;
  } = {},
): string {
  const summary = options.summary || summarizeAgentUiActivity(activity);
  const parts: string[] = [];
  if (summary.codeCount > 0) parts.push(`Ran code ${summary.codeCount}×`);
  parts.push(`${summary.requestCount} request${summary.requestCount === 1 ? "" : "s"}`);
  if (summary.outcome === "interrupted") {
    const how = summary.interruptedBy
      ? `interrupted by ${sentByMe(summary.interruptedBy, options.me) ? "you" : saidByOf(summary.interruptedBy)}`
      : "interrupted";
    parts.push(
      summary.interruptedWithPartialResponse && options.interruptedPartialHint
        ? `${how} (${options.interruptedPartialHint})`
        : how,
    );
  }
  if (summary.outcome === "failed") parts.push("failed");
  const totalMs =
    activity.endedAtMs == null ? null : Math.max(0, activity.endedAtMs - activity.startedAtMs);
  if (totalMs != null && totalMs > 0) parts.push(formatAgentUiDuration(totalMs));
  return parts.join(" · ");
}

/** One activity round: the llm step that writes a script and the code step that runs it. */
export type AgentUiActivityRound = {
  llm: AgentUiLlmStep | null;
  code: AgentUiCodeStep | null;
};

/**
 * Group an activity's steps into ROUNDS: the llm step that writes a script
 * and the code step that runs it belong together, and an agent that returns
 * itself a value for the next attempt produces round 2, 3, … A round opens at
 * every llm step (or at a code step with no llm before it — replays can drop
 * the llm half). The agent feed groups through this one function.
 */
export function groupActivityRounds(steps: readonly AgentUiStep[]) {
  const rounds: AgentUiActivityRound[] = [];
  for (const step of steps) {
    const current = rounds.at(-1);
    if (step.kind === "llm") {
      rounds.push({ llm: step, code: null });
    } else if (current && !current.code) {
      current.code = step;
    } else {
      rounds.push({ llm: null, code: step });
    }
  }
  return rounds;
}

export function formatAgentUiDuration(durationMs: number): string {
  if (durationMs < 1000) return `${Math.round(durationMs)} ms`;
  if (durationMs < 60_000) return `${(durationMs / 1000).toFixed(1).replace(/\.0$/, "")} s`;
  const seconds = Math.round(durationMs / 1000);
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function isAgentUiActivityWorking(activity: AgentUiActivity | null): boolean {
  return Boolean(activity?.steps.some((step) => step.status === "running"));
}

/** What the live activity is doing right now, from journal facts alone. */
export type AgentUiLivePhase =
  | "working"
  | "waiting"
  | "thinking"
  | "writing"
  | "running"
  | "processing";

export type AgentUiLiveStatus = {
  phase: AgentUiLivePhase;
  /** Agent-authored `activity` text set during THIS turn (a summary-updated
   * folded since the live activity started), or null — code steps inherit
   * `summaryActivity` at birth, so their stamp alone can be stale
   * previous-turn text and is deliberately not used here. */
  statusText: string | null;
};

/**
 * The live activity's current phase plus this turn's agent-set status text.
 * "processing" covers the two owed-but-not-yet-journaled gaps, both derived
 * from facts already in the journal — no timer debounce, no new events:
 * - the last step is a script that durably settled WITH a returned value
 *   (codemode contract: a returned value means another LLM round follows);
 * - the last step is a COMPLETED llm response whose text carries a codemode
 *   script block — the agent's `itx/run-requested` is coming,
 *   and without this the card flashed settled between "writing code" and
 *   "running code".
 */
export function deriveAgentUiLiveStatus(state: AgentUiState): AgentUiLiveStatus | null {
  const live = state.live;
  if (!live) return null;
  const statusText =
    state.summaryActivity &&
    state.summaryActivityUpdatedAtMs !== null &&
    state.summaryActivityUpdatedAtMs >= live.startedAtMs
      ? state.summaryActivity
      : null;
  const phase = () => {
    const current = live.steps.findLast((step) => step.status === "running");
    if (current?.kind === "code") return "running";
    if (current?.kind === "llm" && current.responseText.length > 0) return "writing";
    if (current?.kind === "llm" && (current.thinkingText.length > 0 || current.thinking))
      return "thinking";
    if (current?.kind === "llm") return "waiting";
    const last = live.steps.at(-1);
    // A paused agent owes no follow-up, whatever the last step promised — a
    // pause folded mid-request must not leave a permanent claim after that
    // request's outcome lands.
    if (!state.paused && last?.kind === "code") {
      if (last.status === "done" && last.success && last.result !== undefined) {
        return "processing";
      }
    }
    if (!state.paused && last?.kind === "llm") {
      // The response finished and visibly contains a script: what follows is
      // a journal fact either way — itx/run-requested when the script may run,
      // or another llm request when the agent refused it — so the turn is not
      // over.
      if (
        last.status === "done" &&
        last.outcome === "completed" &&
        sliceText(last.responseText).includes("<codemode")
      ) {
        return "processing";
      }
    }
    return "working";
  };
  return { phase: phase(), statusText };
}

/** Whether the live row shows its spinner: a step runs, or none does but the journal already owes
 *  one ("processing": a script the model wrote, or the round after a script's value), so the spinner
 *  stays through the gap. */
export function isAgentUiLiveRowWorking(state: AgentUiState): boolean {
  if (!state.live) return false;
  return (
    isAgentUiActivityWorking(state.live) || deriveAgentUiLiveStatus(state)?.phase === "processing"
  );
}

/** A file attachment shown alongside a user message in the agent UI. */
export type AgentUiFileAttachment = {
  contentType: string;
  filename: string;
  path: string;
  size: number;
};

export type AgentUiMessageItem = {
  kind: "user" | "assistant";
  id: string;
  /** Offset of the event that carried the message. */
  offset: number;
  text: string;
  timestampMs: number;
  files?: AgentUiFileAttachment[];
  /** Who sent it, when the platform stamped a person on its event (stream-event.ts `senderOf`). */
  sender?: MessageSender;
  /** The sender's short label (stream-event.ts `saidByOf`), drawn under the bubble of anyone but
   *  the viewer. */
  saidBy?: string;
  /** The context that sent it, when that is another context than the mind's root: another agent.
   *  Its words are a report to the agent, not a person's. */
  from?: string;
};

export type AgentUiStreamPauseItem = {
  kind: "stream-paused" | "stream-resumed";
  id: string;
  text: string;
  reason?: string;
  timestampMs: number;
};

/** One input that started no turn. */
export type AgentUiBackgroundMessage = {
  offset: number;
  text: string;
  timestampMs: number;
  files?: AgentUiFileAttachment[];
  /** The context that sent it, as on a message item. */
  from?: string;
};

/** Inputs that started no turn (`dont-trigger-request`): what the agent reads, which no one said to
 *  it. The reducer emits one per event; `foldAgentLog` joins a run of them into one row, whose id
 *  stays its first input's as the run grows. */
export type AgentUiBackgroundItem = {
  kind: "background";
  id: string;
  /** Offset of the first input. */
  offset: number;
  messages: AgentUiBackgroundMessage[];
};

/** ONE PLAIN ROW for a fact of the agent that is no message and no step: a request for an answer
 *  and its reason, a subagent started or failed, words sent to Slack or refused there
 *  (agent-facts.ts names them). */
export type AgentUiNoteItem = {
  kind: "note";
  id: string;
  /** Offset of the fact. */
  offset: number;
  /** What it is about, for the row's icon. */
  about: "request" | "subagent" | "slack";
  /** The row's words. */
  text: string;
  /** More words, opened under the row: an error, the words sent. */
  detail?: string;
  failed?: boolean;
  timestampMs: number;
};

export type AgentUiItem =
  | AgentUiMessageItem
  | AgentUiActivity
  | AgentUiStreamPauseItem
  | AgentUiBackgroundItem
  | AgentUiNoteItem;

export type AgentUiState = {
  /** The running activity (streaming thinking/code), or null when no work is active. */
  live: AgentUiActivity | null;
  /** Assistant bubbles held until the grouped activity closes. */
  deferredAssistantMessages: AgentUiMessageItem[];
  /** User messages that landed while a step ran and that no request has taken up yet. */
  queuedUserMessages: AgentUiMessageItem[];
  /** Inputs that started no turn, held behind the open activity to keep their place in the log.
   *  Apart from the queue: no request is owed to them. The plain rows of the agent's other facts
   *  wait here too. */
  heldBackground: (AgentUiBackgroundItem | AgentUiNoteItem)[];
  /** Latest agent/summary-updated `activity` text — stamped onto code steps. */
  summaryActivity: string | null;
  /** When that text was folded. Compared against the live activity's start
   * to tell a this-turn status from stale previous-turn text (code steps
   * inherit `summaryActivity` at birth regardless of age). */
  summaryActivityUpdatedAtMs: number | null;
  /** The stream/agent is paused (agent/paused or itx/paused, uncleared by
   * a resume). A paused agent owes no follow-up round, so the "processing"
   * inference must not claim one. */
  paused: boolean;
  /** Each `agent/message-received` (the platform's `message()`), by its offset: who sent it, the
   *  context that sent it, its words and its files. The `agent/context-added` that names it in
   *  `source` is its transcription for the model, and is drawn with these. The entry goes then. */
  senderByMessage: Record<
    number,
    { sender?: MessageSender; from?: string; words: string; files: AgentUiFileAttachment[] }
  >;
  /** Who sent the newest input that interrupts the answer being written (its policy says so): the
   *  request it stops is settled cancelled after it, and takes this as who stopped it. */
  interruptBy?: MessageSender;
  /** The Dash's words to the agent (`agent-ui/message-received`) drawn as a bubble, by offset: its
   *  context path, when the row has one, and who wrote it. The `agent/context-added` that names it
   *  in `source` is its transcription for the model, and is drawn nowhere. The entry goes then. */
  drawnInputs: Record<number, { path?: string; sender?: MessageSender }>;
  /** The path of each subagent asked for (`agent/subagent-requested`), by offset, until it started
   *  or failed: the failure names only the request. */
  subagentPaths: Record<number, string>;
};

export function initialAgentUiState(): AgentUiState {
  return {
    live: null,
    deferredAssistantMessages: [],
    queuedUserMessages: [],
    heldBackground: [],
    summaryActivity: null,
    summaryActivityUpdatedAtMs: null,
    paused: false,
    senderByMessage: {},
    drawnInputs: {},
    subagentPaths: {},
  };
}

/**
 * Fold ONE event into settled items + the resulting state. Items are appended
 * to `items` in emission order; the caller owns
 * list positions. Idempotent by construction: replaying the same event from
 * the same entry state yields the same items.
 */
export function reduceAgentUi(
  start: AgentUiState,
  event: StreamEvent,
): { endState: AgentUiState; items: AgentUiItem[] } {
  const items: AgentUiItem[] = [];
  const endState = reduceAgentUiEvent(start, event, items);
  return { endState, items };
}

/**
 * Flush at an idle boundary the agent reports outside the journal: once no step
 * is running, the live activity closes and the deferred and queued messages
 * follow it. A running step stays running — only its own settlement closes it.
 * Callers render the returned items as a transient tail; the reduction itself
 * stays journal facts only.
 */
export function settleAgentUiAtIdleBoundary(start: AgentUiState): {
  endState: AgentUiState;
  items: AgentUiItem[];
} {
  if (isAgentUiActivityWorking(start.live)) return { endState: start, items: [] };
  const items: AgentUiItem[] = [];
  const endState = flushDeferredMessages(settleLive(start, items), items);
  return { endState, items };
}

function reduceAgentUiEvent(
  state: AgentUiState,
  event: StreamEvent,
  items: AgentUiItem[],
): AgentUiState {
  const timestampMs = Date.parse(event.createdAt);
  // Committed events are expected to carry an ISO timestamp. A malformed
  // timestamp must not manufacture NaN durations or deadlines; keep the raw
  // event visible, but do not fold it into the typed agent projection.
  if (!Number.isFinite(timestampMs)) return state;

  switch (event.type) {
    // THE PLATFORM'S `message()` (`agent/message-received`): the platform stamped who sent it. Its
    // bubble is drawn where the mind transcribes it for the model (`reduceTranscription`).
    case "events.iterate.com/agent/message-received": {
      const words = readString(event, "message");
      // oxlint-disable-next-line iterate/simple-truthiness-check -- empty words are a message: a person can send files alone
      if (words == null) return state;
      return {
        ...state,
        senderByMessage: {
          ...state.senderByMessage,
          [event.offset]: {
            sender: senderOf(event.source),
            from: readContextFrom(event),
            words,
            files: readFileAttachments(event),
          },
        },
      };
    }

    // THE DASH'S WORDS TO THE AGENT (agent-facts.ts): the bubble, with the sender the platform
    // stamped on the fact, and its files. Its transcription for the model is drawn nowhere.
    case AGENT_FACT.uiMessageReceived: {
      const text = readString(event, "message");
      // oxlint-disable-next-line iterate/simple-truthiness-check -- empty words are a message: a person can send files alone
      if (text == null) return state;
      const files = readFileAttachments(event);
      const sender = senderOf(event.source);
      const drawn = { path: event.path, sender };
      return emitUserMessageItem(
        { ...state, drawnInputs: { ...state.drawnInputs, [event.offset]: drawn } },
        items,
        {
          kind: "user",
          id: `user-${event.offset}`,
          offset: event.offset,
          text,
          ...(files.length === 0 ? {} : { files }),
          timestampMs,
          sender,
          saidBy: sender && saidByOf(sender),
        },
      );
    }

    // THE AGENT'S ONE INPUT. A person's words (role `user`) are a bubble, or a quiet row when they
    // start no request. A transcription of a raw fact the chat holds is drawn from that fact. What
    // was said in the agent's name (`assistant`) and the system's words are drawn nowhere: the chat
    // draws the words a person saw (`agent-ui/message-sent`). A developer note is drawn only when
    // an agent wrote it (`actor: { type: "agent" }`, as cloud-handover.ts writes).
    case "events.iterate.com/agent/context-added": {
      const role = readString(event, "role");
      const text = readString(event, "content");
      // oxlint-disable-next-line iterate/simple-truthiness-check -- empty content is a real message: a person can send files alone
      if (text == null || role === "assistant" || role === "system") return state;
      // THE AGENT'S TRANSCRIPTION of a raw fact (agent-facts.ts): the bubble is the raw fact's
      const transcribed = role === "user" ? transcribedFactOf(event) : undefined;
      const fromRaw = transcribed && reduceTranscription(state, event, transcribed, items);
      if (fromRaw) return fromRaw;

      const files = readFileAttachments(event);
      const sender = senderOf(event.source);
      // THE INTERRUPT is input whose policy says so: a press of Interrupt (a developer item) or a
      // person's words to an agent set to be interrupted. Who sent it is who stopped the answer.
      const policy = readRecord(event, "llmRequestPolicy")?.behaviour;
      const heard =
        policy === "interrupt-current-request" ? { ...state, interruptBy: sender } : state;
      if (role === "user") {
        const message = {
          offset: event.offset,
          text,
          ...(files.length === 0 ? {} : { files }),
          timestampMs,
          sender,
          saidBy: sender && saidByOf(sender),
          from: writerContextOf(event),
        };
        if (policy === "dont-trigger-request")
          return emitBackgroundItem(heard, items, {
            kind: "background",
            id: `background-${event.offset}`,
            offset: event.offset,
            messages: [message],
          });
        return emitUserMessageItem(heard, items, {
          kind: "user",
          id: `user-${event.offset}`,
          ...message,
        });
      }
      if (readRecord(event, "actor")?.type === "agent") {
        return emitUserMessageItem(heard, items, {
          kind: "user",
          id: `user-${event.offset}`,
          offset: event.offset,
          text,
          ...(files.length === 0 ? {} : { files }),
          timestampMs,
        });
      }
      return heard;
    }

    // the agent's words for a person: a script of its response appends them
    case AGENT_FACT.uiMessageSent: {
      const text = readString(event, "message");
      // oxlint-disable-next-line iterate/simple-truthiness-check -- an empty message is still a sent message: it can carry attachments alone
      if (text == null) return state;
      const files = readFileAttachments(event);
      return emitAssistantMessageItem(state, items, {
        kind: "assistant",
        id: `assistant-${event.offset}`,
        offset: event.offset,
        text,
        ...(files.length === 0 ? {} : { files }),
        timestampMs,
      });
    }

    // THE AGENT'S REQUEST. Only its answer is a step: a `summary` or a `side` request is no answer
    // of the agent, and the feed draws it nowhere (its trace and the Events tab have it). Every
    // answer request opens: the agent settles each one it asks.
    case AGENT_FACT.llmRequested: {
      if (readString(event, "purpose") !== "answer") return state;
      // The agent builds a request's prompt from the log, so this request answers every queued
      // input: the activity it waited behind closes, and every held message moves into the
      // transcript in log order. A step that still runs (a script outlives the request that wrote
      // it) keeps its activity live, since only its settlement ends it; this request joins that
      // activity, and the script's later replies wait for it.
      const ready =
        state.queuedUserMessages.length === 0 && state.live
          ? state
          : flushDeferredMessages(settleLive(state, items), items);
      return withLlmStep(ready, event, timestampMs);
    }

    case AGENT_FACT.llmResponseFrame: {
      const payload = readPayloadRecord(event);
      const llmRequestOffset = payload?.llmRequestOffset;
      if (!payload || typeof llmRequestOffset !== "number") return state;
      const responseDelta = typeof payload.textDelta === "string" ? payload.textDelta : "";
      const thinkingDelta = typeof payload.thinkingDelta === "string" ? payload.thinkingDelta : "";
      const attempt = typeof payload.attempt === "number" ? payload.attempt : 0;
      const thinking = payload.thinking === true;
      return updateLlmStep(state, llmRequestOffset, (step) =>
        !responseDelta && !thinkingDelta && thinking === Boolean(step.thinking)
          ? step
          : streamedInto(step, { attempt, responseDelta, thinkingDelta, thinking }),
      );
    }

    case AGENT_FACT.llmSettled: {
      const payload = readPayloadRecord(event);
      const llmRequestOffset = payload?.llmRequestOffset;
      if (!payload || typeof llmRequestOffset !== "number") return state;
      return settledLlmStep(state, llmRequestOffset, payload, timestampMs);
    }

    // The CONTEXT's script run (core/itx runs it): the request's offset is the
    // run, and its settlement names that offset back.
    case "events.iterate.com/itx/run-requested": {
      const parsed = RunRequested.safeParse(event.payload);
      if (!parsed.success) return state;
      // the agent's key names the request whose response holds the script (agent-facts.ts): that
      // response's llm step is interpreted, since the Script tab now carries the code
      const askedBy = scriptRequestOffsetOf(event.idempotencyKey);
      const interpretedState =
        askedBy === undefined
          ? state
          : updateLlmStep(state, askedBy, (step) => ({ ...step, interpreted: true }));
      const live = ensureLive(interpretedState, event.offset, timestampMs);
      const step: AgentUiCodeStep = {
        kind: "code",
        id: `code-${event.offset}`,
        requestOffset: event.offset,
        status: "running",
        code: parsed.data.code,
        startedAtMs: timestampMs,
        deadlineAtMs: timestampMs + RUN_DEADLINE_MS,
        // Inherit the stream's summary status from birth, so live headers
        // carry it — not only settled rounds.
        activitySummary: state.summaryActivity || undefined,
      };
      return { ...interpretedState, live: { ...live, steps: [...live.steps, step] } };
    }

    case "events.iterate.com/itx/run-settled": {
      const parsed = RunSettled.safeParse(event.payload);
      if (!parsed.success || !state.live) return state;
      const { requestOffset, settlement } = parsed.data;
      const steps = [...state.live.steps];
      const index = steps.findIndex(
        (step) => step.kind === "code" && step.requestOffset === requestOffset,
      );
      const step = steps[index];
      // The first settlement wins; a run this feed never saw requested is not a step.
      if (!step || step.kind !== "code" || step.status !== "running") return state;
      steps[index] = {
        ...step,
        status: "done",
        durationMs: Math.max(0, timestampMs - step.startedAtMs),
        endedAtMs: timestampMs,
        ...(settlement.status === "succeeded"
          ? {
              success: true,
              ...(Object.hasOwn(settlement, "result") && { result: settlement.result }),
            }
          : { success: false, errorMessage: settlement.error }),
        // The stream's summary status as of this round — inherited from an
        // earlier round when this one's script didn't update it.
        activitySummary: state.summaryActivity || undefined,
      };
      const next = { ...state, live: { ...state.live, steps } };
      // A reply can still be held here (one that waited for the work running beside it; see
      // emitAssistantMessageItem). If this settle is the turn's last journal fact — nothing
      // running, no follow-up round — no later event exists to flush it, and the idle-boundary
      // flush is a transient overlay driven by the agent's idle report, which can lag or wedge.
      // Journal facts alone must surface a sent message: settle the activity here and flush. A
      // paused agent is the same situation even with no deferred messages: the pause fact already
      // landed (possibly mid-request), no follow-up round is coming, and no second pause will
      // arrive to close the activity. A script whose message already went out at once is the same
      // when it returned nothing (the turn ends, no follow-up round), or did not succeed: nothing
      // else is sure to close the activity. A script that returned a value is followed by a
      // request that joins this activity, so it stays open for that. Its message counts only when
      // no later step joined the activity: that step's turn is not over because this script's is.
      const turnEnds = settlement.status === "succeeded" && settlement.result === undefined;
      const scriptRepliedAtOnce =
        step.repliedAtOnce &&
        index === steps.length - 1 &&
        (turnEnds || settlement.status !== "succeeded");
      if (
        (next.deferredAssistantMessages.length > 0 ||
          next.queuedUserMessages.length > 0 ||
          next.paused ||
          scriptRepliedAtOnce) &&
        !isAgentUiActivityWorking(next.live)
      ) {
        return flushDeferredMessages(settleLive(next, items), items);
      }
      return next;
    }

    case "events.iterate.com/agent/summary-updated": {
      const activity = readString(event, "activity");
      if (!activity) return state;
      // Summaries are usually appended by the running script itself, so the
      // running code step picks the new text up immediately (live rounds show
      // it before the settle stamp lands).
      if (state.live) {
        const steps = state.live.steps.map((step) =>
          step.kind === "code" && step.status === "running"
            ? { ...step, activitySummary: activity }
            : step,
        );
        return {
          ...state,
          summaryActivity: activity,
          summaryActivityUpdatedAtMs: timestampMs,
          live: { ...state.live, steps },
        };
      }
      return { ...state, summaryActivity: activity, summaryActivityUpdatedAtMs: timestampMs };
    }

    // The stream-level facts (the whole stream stops accepting appends) and
    // the agent-level facts (the agent asks for no request — its own bound on
    // failures and on requests, or an operator) render as the same
    // pause/resume marker rows. A pause is
    // also a run boundary: no more work is coming, so an idle live activity
    // (e.g. mid-turn after a script returned a value — the "processing" gap)
    // settles from this journal fact alone instead of waiting on the
    // idle-boundary overlay. A still-running step keeps the activity
    // live: agent/paused is operator/script-appendable while a request is
    // open, and that request settles normally.
    case "events.iterate.com/itx/paused":
    case "events.iterate.com/agent/paused": {
      const settled = settleLive({ ...state, paused: true }, items);
      const flushed = settled.live ? settled : flushDeferredMessages(settled, items);
      items.push({
        kind: "stream-paused",
        id: `stream-paused-${event.offset}`,
        text: "Agent paused",
        ...readOptionalReason(event),
        timestampMs,
      });
      return flushed;
    }

    case "events.iterate.com/itx/resumed":
    case "events.iterate.com/agent/resumed":
      items.push({
        kind: "stream-resumed",
        id: `stream-resumed-${event.offset}`,
        text: "Agent resumed",
        ...readOptionalReason(event),
        timestampMs,
      });
      return { ...state, paused: false };

    // THE AGENT'S OTHER FACTS: one plain row each (agent-facts.ts)
    case AGENT_FACT.llmRequestTriggered: {
      const reason = readString(event, "reason");
      return emitNoteItem(state, items, event, timestampMs, {
        about: "request",
        text: reason ? `Asked for an answer: ${reason}` : "Asked for an answer",
      });
    }

    case AGENT_FACT.subagentRequested: {
      const path = readString(event, "path");
      if (!path) return state;
      return { ...state, subagentPaths: { ...state.subagentPaths, [event.offset]: path } };
    }

    case AGENT_FACT.subagentStarted:
    case AGENT_FACT.subagentFailed: {
      const requestOffset = readNumber(event, "requestOffset");
      const asked = requestOffset === null ? undefined : state.subagentPaths[requestOffset];
      const subagentPaths =
        requestOffset === null
          ? state.subagentPaths
          : withoutKey(state.subagentPaths, requestOffset);
      const path = readString(event, "path") ?? asked;
      const copied = readNumber(event, "copiedItems") ?? 0;
      const error = readString(event, "error");
      const started = event.type === AGENT_FACT.subagentStarted;
      return emitNoteItem({ ...state, subagentPaths }, items, event, timestampMs, {
        about: "subagent",
        text: started
          ? `Started a subagent${path ? ` at ${path}` : ""}${copied > 0 ? `, with ${String(copied)} items of this conversation` : ""}`
          : `A subagent${path ? ` at ${path}` : ""} did not start`,
        detail: error || undefined,
        ...(started ? {} : { failed: true }),
      });
    }

    case AGENT_FACT.slackMessageSent:
    case AGENT_FACT.slackMessageFailed: {
      const sent = event.type === AGENT_FACT.slackMessageSent;
      const channel = readString(event, "channel");
      const detail = sent ? readString(event, "text") : readString(event, "error");
      return emitNoteItem(state, items, event, timestampMs, {
        about: "slack",
        text: sent
          ? `Sent a Slack message${channel ? ` in ${channel}` : ""}`
          : "A Slack message was not sent",
        detail: detail || undefined,
        ...(sent ? {} : { failed: true }),
      });
    }

    default:
      return state;
  }
}

/** A plain row of the agent's facts. As an input that starts no turn, it says nothing of the turn
 *  under way: behind an open activity it waits, and comes out where the log has it. */
function emitNoteItem(
  state: AgentUiState,
  items: AgentUiItem[],
  event: StreamEvent,
  timestampMs: number,
  note: Pick<AgentUiNoteItem, "about" | "text" | "detail" | "failed">,
): AgentUiState {
  const item: AgentUiNoteItem = {
    kind: "note",
    id: `note-${String(event.offset)}`,
    offset: event.offset,
    timestampMs,
    ...note,
  };
  if (state.live) return { ...state, heldBackground: [...state.heldBackground, item] };
  items.push(item);
  return state;
}

/** The raw fact an `agent/context-added` was made from (`source: { path, offset }`): the agent's
 *  transcription of a channel's words. */
function transcribedFactOf(event: StreamEvent): { path: string; offset: number } | undefined {
  const source = readRecord(event, "source");
  return typeof source?.path === "string" && typeof source.offset === "number"
    ? { path: source.path, offset: source.offset }
    : undefined;
}

/** A TRANSCRIPTION whose raw fact the chat drew or holds. The Dash's words are their bubble
 *  already: the transcription is drawn nowhere, and an interrupt it carries is by the words'
 *  sender. The platform's `message()` on this agent (`agent/message-received`) is drawn here from
 *  the raw fact: its words, its files, its sender, the context that sent it. Undefined for any
 *  other: a channel's words (Slack) are drawn from the transcription, as they are. */
function reduceTranscription(
  state: AgentUiState,
  event: StreamEvent,
  raw: { path: string; offset: number },
  items: AgentUiItem[],
): AgentUiState | undefined {
  const policy = readRecord(event, "llmRequestPolicy")?.behaviour;
  const drawn = state.drawnInputs[raw.offset];
  if (drawn && (!drawn.path || drawn.path === raw.path)) {
    const drawnInputs = withoutKey(state.drawnInputs, raw.offset);
    return policy === "interrupt-current-request"
      ? { ...state, drawnInputs, interruptBy: drawn.sender }
      : { ...state, drawnInputs };
  }
  const named = state.senderByMessage[raw.offset];
  if (!named || (event.path && event.path !== raw.path)) return undefined;
  const taken = { ...state, senderByMessage: withoutKey(state.senderByMessage, raw.offset) };
  const { files } = named;
  const message = {
    offset: event.offset,
    text: named.words,
    ...(files.length === 0 ? {} : { files }),
    timestampMs: Date.parse(event.createdAt),
    sender: named.sender,
    saidBy: named.sender && saidByOf(named.sender),
    from: named.from,
  };
  if (policy === "dont-trigger-request")
    return emitBackgroundItem(taken, items, {
      kind: "background",
      id: `background-${event.offset}`,
      offset: event.offset,
      messages: [message],
    });
  const heard =
    policy === "interrupt-current-request" ? { ...taken, interruptBy: named.sender } : taken;
  return emitUserMessageItem(heard, items, {
    kind: "user",
    id: `user-${event.offset}`,
    ...message,
  });
}

/** The context that wrote an input, by the platform's stamp (`source.origin`), when that is
 *  another context than the agent's own, the mind's root or `/agents`: another agent's words.
 *  A schedule's occurrence or a row's copy names no writer. */
function writerContextOf(event: StreamEvent): string | undefined {
  const origin = event.source?.origin;
  if (!event.path || !origin?.startsWith("/")) return undefined;
  if (event.source?.schedule || event.source?.copiedFrom || event.source?.platform)
    return undefined;
  return [event.path, "/", "/agents"].includes(origin) ? undefined : origin;
}

/** A new running llm step for the request `event` (its offset is the request's), in the live
 *  activity of `ready`. */
function withLlmStep(ready: AgentUiState, event: StreamEvent, timestampMs: number): AgentUiState {
  const live = ensureLive(ready, event.offset, timestampMs);
  const model = readString(event, "model");
  const step: AgentUiLlmStep = {
    kind: "llm",
    id: `llm-${event.offset}`,
    llmRequestOffset: event.offset,
    status: "running",
    model: model || undefined,
    thinkingText: "",
    responseText: "",
    startedAtMs: timestampMs,
  };
  return { ...ready, live: { ...live, steps: [...live.steps, step] } };
}

/** One streamed window folded into its step. A settled step streams no more, and a late window of
 *  an earlier answer shows nothing. The first window of a later answer replaces what the failed one
 *  showed. `thinking`, when the window says it: the provider reports that the model reasons. */
function streamedInto(
  step: AgentUiLlmStep,
  window: { attempt: number; responseDelta: string; thinkingDelta: string; thinking?: boolean },
): AgentUiLlmStep {
  const { attempt, responseDelta, thinkingDelta, thinking } = window;
  const showing = step.attempt ?? 0;
  if (step.status !== "running" || attempt < showing) return step;
  const shown = attempt > showing ? { responseText: "", thinkingText: "" } : step;
  return {
    ...step,
    attempt,
    responseText:
      responseDelta === "" ? shown.responseText : appendText(shown.responseText, responseDelta),
    thinkingText:
      thinkingDelta === "" ? shown.thinkingText : appendText(shown.thinkingText, thinkingDelta),
    thinking: thinking ?? step.thinking,
  };
}

/** THE ONE TERMINAL FACT for a request (succeeded | failed | cancelled), folded into its step. A
 *  success holds the answer whole, which then is the step's text. */
function settledLlmStep(
  state: AgentUiState,
  requestOffset: number,
  payload: Record<string, unknown>,
  timestampMs: number,
): AgentUiState {
  const result = isRecord(payload.result) ? payload.result : undefined;

  const status = typeof result?.status === "string" ? result.status : "succeeded";
  const usage = readUsageTokens(result?.usage);
  const errorMessage = typeof result?.errorMessage === "string" ? result.errorMessage : undefined;
  const parsedCancelReason = AgentLlmRequestCancelReason.safeParse(result?.reason);
  const cancelReason = parsedCancelReason.success ? parsedCancelReason.data : null;
  // The durable record of what streamed before an interrupt. Chunks are
  // ephemeral, so a rebuild from the journal (refresh, TUI/mobile) has an
  // empty responseText — the settled fact fills it in.
  const partialText = typeof result?.partialText === "string" ? result.partialText : null;
  return updateLlmStep(state, requestOffset, (step) =>
    step.outcome
      ? step
      : {
          ...step,
          status: "done",
          endedAtMs: timestampMs,
          outcome:
            status === "succeeded" ? "completed" : status === "failed" ? "failed" : "cancelled",
          // partialText is the authoritative superset: it accrued per
          // provider chunk, while responseText only holds FLUSHED windows
          // — an interrupt can strand up to one coalescing window's tail
          // in the buffer. Adopt the recorded text when it extends the preview.
          ...(status === "succeeded" &&
            typeof result?.text === "string" && { responseText: result.text, thinking: false }),
          ...(partialText &&
            partialText.length > step.responseText.length &&
            partialText.startsWith(sliceText(step.responseText)) && {
              responseText: partialText,
            }),
          ...(typeof payload.durationMs === "number"
            ? { durationMs: payload.durationMs }
            : status === "cancelled"
              ? { durationMs: Math.max(0, timestampMs - step.startedAtMs) }
              : {}),
          inputTokens: usage.input,
          outputTokens: usage.output,
          errorMessage,
          cancelReason: cancelReason || undefined,
          interruptedBy:
            cancelReason === "interrupted-by-user-input" ? state.interruptBy : undefined,
        },
  );
}

function ensureLive(state: AgentUiState, offset: number, startedAtMs: number): AgentUiActivity {
  // Multiple simultaneous steps render as one live activity.
  if (state.live) return { ...state.live, status: "running" };
  return {
    kind: "activity",
    id: `activity-${offset}`,
    status: "running",
    steps: [],
    startedAtMs,
  };
}

/**
 * The state without its running requests: what is left once they are known
 * never to have opened. An activity that held nothing else goes with them.
 */
export function withoutRunningRequests(state: AgentUiState): AgentUiState {
  if (!state.live) return state;
  const steps = state.live.steps.filter((step) => step.kind !== "llm" || step.status !== "running");
  if (steps.length === state.live.steps.length) return state;
  return { ...state, live: steps.length > 0 ? { ...state.live, steps } : null };
}

/**
 * Close the live activity once nothing in it runs — every step closed by its
 * own settlement — and emit it as a settled item, ended when its last step did:
 * what closes it can come much later (the next words after a silent turn). A
 * working activity stays live: nothing but a step's settlement ends it.
 */
function settleLive(state: AgentUiState, items: AgentUiItem[]): AgentUiState {
  if (!state.live || isAgentUiActivityWorking(state.live)) return state;
  const { steps } = state.live;
  if (steps.length > 0) {
    const endedAtMs = Math.max(...steps.map((step) => step.endedAtMs ?? step.startedAtMs));
    items.push({ ...state.live, status: "done", endedAtMs });
  }
  return { ...state, live: null };
}

/**
 * Emit the held assistant and user messages in log order, so a reply never
 * lands above the question before it. The two queues stay separate so that
 * assistant bubbles never show in the composer's "queued messages" panel.
 */
function flushDeferredMessages(state: AgentUiState, items: AgentUiItem[]): AgentUiState {
  items.push(
    ...[
      ...state.deferredAssistantMessages,
      ...state.queuedUserMessages,
      ...state.heldBackground,
    ].sort((a, b) => a.offset - b.offset),
  );
  return { ...state, deferredAssistantMessages: [], queuedUserMessages: [], heldBackground: [] };
}

/** An input that starts no turn says nothing of the turn under way, so it closes no activity and
 *  joins no queue: an activity with no step running may be a turn's gap between two steps. Behind
 *  one it waits, and comes out where the log has it. */
function emitBackgroundItem(
  state: AgentUiState,
  items: AgentUiItem[],
  item: AgentUiBackgroundItem,
): AgentUiState {
  if (state.live) return { ...state, heldBackground: [...state.heldBackground, item] };
  items.push(item);
  return state;
}

// A user message while steps are still running must not archive those steps
// as finished — the agent is still working. Queue it for the next flush;
// otherwise emit directly. Shared by plain user messages and file-attachment
// inputs.
function emitUserMessageItem(
  state: AgentUiState,
  items: AgentUiItem[],
  item: AgentUiMessageItem,
): AgentUiState {
  const settled = settleLive(state, items);
  if (isAgentUiActivityWorking(settled.live)) {
    return { ...settled, queuedUserMessages: [...settled.queuedUserMessages, item] };
  }
  const flushed = settled.live ? settled : flushDeferredMessages(settled, items);
  items.push(item);
  return flushed;
}

/**
 * Assistant output belongs after the activity that produced it, so a message
 * cannot split a running script group. A message a RUNNING SCRIPT sends lands
 * at once instead, above the still-live activity, after the held replies
 * before it in log order: a script that sends a link and then polls must not
 * hide the link until it settles. The activity stays live and whole until its
 * own settlements close it. The running code step is marked `repliedAtOnce`,
 * so a script settlement that ends the turn closes it (see itx/run-settled).
 * A message while only an llm step runs is held.
 */
function emitAssistantMessageItem(
  state: AgentUiState,
  items: AgentUiItem[],
  item: AgentUiMessageItem,
): AgentUiState {
  // A live activity that survives settleLive is working.
  const settled = settleLive(state, items);
  if (!settled.live) {
    const flushed = flushDeferredMessages(settled, items);
    items.push(item);
    return flushed;
  }
  const scriptRuns = settled.live.steps.some(
    (step) => step.kind === "code" && step.status === "running",
  );
  if (scriptRuns) {
    items.push(...settled.deferredAssistantMessages, item);
    const steps = settled.live.steps.map((step) =>
      step.kind === "code" && step.status === "running" ? { ...step, repliedAtOnce: true } : step,
    );
    return { ...settled, live: { ...settled.live, steps }, deferredAssistantMessages: [] };
  }
  return {
    ...settled,
    deferredAssistantMessages: [...settled.deferredAssistantMessages, item],
  };
}

function updateLlmStep(
  state: AgentUiState,
  llmRequestOffset: number,
  update: (step: AgentUiLlmStep) => AgentUiLlmStep,
): AgentUiState {
  if (!state.live) return state;
  const index = state.live.steps.findIndex(
    (step) => step.kind === "llm" && step.llmRequestOffset === llmRequestOffset,
  );
  const step = state.live.steps[index];
  if (!step || step.kind !== "llm") return state;
  const steps = [...state.live.steps];
  steps[index] = update(step);
  return { ...state, live: { ...state.live, steps } };
}

/** `record` without the entry `key`. */
function withoutKey<Value>(record: Record<number, Value>, key: number): Record<number, Value> {
  return Object.fromEntries(Object.entries(record).filter(([held]) => Number(held) !== key));
}

function readUsageTokens(usage: unknown): { input?: number; output?: number } {
  if (!isRecord(usage)) return {};
  // The settled event's normalized usage (the contract's camelCase shape).
  return {
    ...(typeof usage.inputTokens === "number" && { input: usage.inputTokens }),
    ...(typeof usage.outputTokens === "number" && { output: usage.outputTokens }),
  };
}

function readFileAttachments(event: StreamEvent): AgentUiFileAttachment[] {
  const value = readPayloadRecord(event)?.files;
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): AgentUiFileAttachment[] => {
    if (!isRecord(item)) return [];
    const contentType = typeof item.contentType === "string" ? item.contentType : null;
    const filename = typeof item.filename === "string" ? item.filename : null;
    const path = typeof item.path === "string" ? item.path : null;
    const size = typeof item.size === "number" && Number.isFinite(item.size) ? item.size : null;
    if (!contentType || !filename || !path || size == null) return [];
    return [{ contentType, filename, path, size }];
  });
}

function readString(event: StreamEvent, key: string): string | null {
  const value = readPayloadRecord(event)?.[key];
  return typeof value === "string" ? value : null;
}

function readOptionalReason(event: StreamEvent): { reason: string } | Record<string, never> {
  const reason = readString(event, "reason");
  return reason ? { reason } : {};
}

function readNumber(event: StreamEvent, key: string): number | null {
  const value = readPayloadRecord(event)?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** The context path an `agent/message-received` names as its sender (`from`, which the agents
 *  collection relays), unless it is the root: `/` is the mind's code and its people, so its words
 *  are a person's. */
function readContextFrom(event: StreamEvent): string | undefined {
  const from = readString(event, "from");
  return from?.startsWith("/") && from !== "/" ? from : undefined;
}

function readRecord(event: StreamEvent, key: string): Record<string, unknown> | null {
  const value = readPayloadRecord(event)?.[key];
  return isRecord(value) ? value : null;
}

function readPayloadRecord(event: StreamEvent): Record<string, unknown> | null {
  return isRecord(event.payload) ? event.payload : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && !!value && !Array.isArray(value);
}
