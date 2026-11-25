// THE AGENT'S FACTS, as the chat reads them: the mind's own agent, whose code is in the mind's config
// repo (core/configs/default/agent/). A person's words come in on a channel
// (`agent-ui/message-received`, or the platform's `agent/message-received`) and the mind
// transcribes them for the model (`agent/context-added` with `source`). A request is
// `llm-request/requested` and its facts, and the agent's words for a person are
// `agent-ui/message-sent`. The reducer (agent-ui-reducer.ts) folds them into rows: a bubble, an
// activity of rounds, a plain row. The request trace (llm-request-trace.ts) reads the exact bodies.
// Nothing here imports the agent: the names and fields are the ones the agent and the Dash agree on.
import { z } from "zod";

const T = "events.iterate.com/";

/** Every type of the agent's facts that the chat reads. */
export const AGENT_FACT = {
  /** The Dash's composer: `message`, `files?`, `client?`. The platform stamps who wrote it. */
  uiMessageReceived: `${T}agent-ui/message-received`,
  /** The Dash's New agent, on the new agent's path: `model?`. */
  uiAgentRequested: `${T}agent-ui/agent-requested`,
  /** The agent's words for a person in the web or mobile UI: `message`. */
  uiMessageSent: `${T}agent-ui/message-sent`,
  /** A widget that the agent's script shows a person (widget/widget.ts): `html`, `text`, `key?`,
   *  `data?`, `title?`, `height?`. */
  uiWidgetShown: `${T}agent-ui/widget-shown`,
  /** A model is asked: `model`, `purpose`, `instructions?`, `extends`, `itemsAdded`. */
  llmRequested: `${T}llm-request/requested`,
  /** One attempt starts: `llmRequestOffset`, `attempt`, `api`, `transport`, `model`. */
  llmAttemptStarted: `${T}llm-request/attempt-started`,
  /** EPHEMERAL: one window of the answer: `textDelta`, `thinkingDelta`, `thinking`. */
  llmResponseFrame: `${T}llm-request/response-frame-received`,
  /** The request's end: `llmRequestOffset`, `attempt`, `durationMs?`, `result`. */
  llmSettled: `${T}llm-request/settled`,
  /** Make a request now, and why: `reason`. */
  llmRequestTriggered: `${T}agent/llm-request-triggered`,
  subagentRequested: `${T}agent/subagent-requested`,
  subagentStarted: `${T}agent/subagent-started`,
  subagentFailed: `${T}agent/subagent-failed`,
  slackMessageSent: `${T}slack/message-sent`,
  slackMessageFailed: `${T}slack/message-failed`,
} as const;

/** The type of the fact `event` of the request maker for the API shape `api`
 *  (`openai-responses/request-started`). The chat knows no API shape by name. */
export const apiFactType = (api: string, event: string) => `${T}${api}/${event}`;

/** The run of a script that a response wrote, by the run's idempotency key: the request, and the
 *  script's place among the response's scripts (`agent/script-run:<request offset>/<index>`). */
export function scriptCallOf(
  idempotencyKey: string | undefined,
): { requestOffset: number; index: number } | undefined {
  const [, offset, index] = /^agent\/script-run:(\d+)\/(\d+)$/.exec(idempotencyKey || "") ?? [];
  return offset && index ? { requestOffset: Number(offset), index: Number(index) } : undefined;
}

/** The request whose response wrote the script that a run runs, by the run's idempotency key. */
export function scriptRequestOffsetOf(idempotencyKey: string | undefined): number | undefined {
  return scriptCallOf(idempotencyKey)?.requestOffset;
}

/** THE AGENT'S LIVE STATE, the fields the chat reads (the facet `agent`). A pause, the open
 *  requests, the inputs that wait for a request, and the scripts that the agent asked to run. */
export const AgentLiveState = z.object({
  paused: z.object({ reason: z.string() }).nullable(),
  llmRequests: z.array(
    z.object({ requestOffset: z.number(), purpose: z.string(), model: z.string() }),
  ),
  pendingTriggerOffsets: z.array(z.number()),
  /** `answered`: the conversation holds the script's result. */
  scriptCalls: z.array(z.object({ answered: z.boolean() })),
});
export type AgentLiveState = z.infer<typeof AgentLiveState>;

/** The agent's live state, or undefined when the facet's state has another shape. */
export function agentLiveStateOf(value: unknown): AgentLiveState | undefined {
  const parsed = AgentLiveState.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/** A file as the mind's file store holds it, which a fact names. */
export type StoredFile = { contentType: string; filename: string; path: string; size: number };

/** THE DASH'S WORDS TO THE AGENT, as ONE fact: the words, the files stored before (`storeFiles`),
 *  and the client. With the composer's key, a send tried again lands once. */
export function agentUiMessage(input: {
  message: string;
  files: readonly StoredFile[];
  key?: string;
  client?: "web" | "mobile";
}) {
  return {
    type: AGENT_FACT.uiMessageReceived,
    ...(input.key && { idempotencyKey: `agent-ui/message-received:${input.key}` }),
    payload: {
      message: input.message,
      ...(input.files.length > 0 && { files: [...input.files] }),
      client: input.client || clientOfBrowser(),
    },
  };
}

/** What the browser says of itself: a phone or a tablet is `mobile`. */
function clientOfBrowser(): "web" | "mobile" {
  return globalThis.navigator && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)
    ? "mobile"
    : "web";
}

/** A file as the composer hands it over: its bytes as base64. */
export type OutgoingFile = { contentType: string; filename: string; data: string };

/** Stores files for one message under the agent's path, as the platform's `message()` stores them
 *  (`<path>/<stem>-<name>`), and answers each as the mind's file store holds it. `key`, the
 *  message's own key: the same files sent again go to the same paths. */
export type StoreFiles = (files: OutgoingFile[], key?: string) => Promise<StoredFile[]>;

/** THE COMPOSER'S SEND TO THE AGENT: its files stored first, then ONE `agent-ui/message-received`
 *  with the words and the files, through `onAppend`. A host that cannot store files sends words
 *  with files through `onMessage` (the platform's `message()`, which stores them). */
export async function sendToAgent<
  Input extends { message: string; files: OutgoingFile[]; key?: string },
>(
  input: Input,
  host: {
    onAppend: (events: unknown[]) => Promise<unknown>;
    onMessage: (input: Input) => Promise<void>;
    storeFiles?: StoreFiles;
  },
): Promise<void> {
  if (input.files.length > 0 && !host.storeFiles) return await host.onMessage(input);
  const files =
    input.files.length > 0 && host.storeFiles ? await host.storeFiles(input.files, input.key) : [];
  await host.onAppend([agentUiMessage({ message: input.message, files, key: input.key })]);
}
