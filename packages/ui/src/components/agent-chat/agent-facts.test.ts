// The agent's facts (agent-facts.ts) through the shared reducer (agent-events.ts
// `reduceAgentFeed`): a person's words, a request that streams, thinks and settles, a script tied to
// its request, the agent's words, and one plain row for each other fact, as the person sees them.
// And the composer's send. The facts and their order are the agent's (core/configs/default
// agent/processor.ts).
import { expect, test } from "vitest";
import { sliceText } from "./chunked-text.ts";
import { foldAgentLog, reduceAgentFeed } from "./agent-events.ts";
import { deriveAgentUiLiveStatus } from "./agent-ui-reducer.ts";
import { sendToAgent } from "./agent-facts.ts";
import {
  ADA,
  fact,
  frame,
  MIND,
  PATH,
  runRequested,
  runSettled,
  sent,
  summary,
  transcription,
  uiMessage,
  type LoggedEvent,
} from "#/test-support/agent-log.ts";

test("one exchange: ONE bubble for the person, with their stamp and no transcription; then the request, its script, the words", () => {
  const { items } = reduceAgentFeed(exchange, true);
  // a message that a running script sends goes out at once, above its activity
  expect(items.map((item) => item.kind)).toEqual(["user", "assistant", "activity"]);
  expect(items).toMatchObject([
    {
      kind: "user",
      offset: 1,
      text: "hello",
      sender: { actor: "usr_1", email: "ada@example.com" },
      saidBy: "ada",
    },
    { kind: "assistant", text: "Hello there." },
    {
      kind: "activity",
      steps: [
        {
          kind: "llm",
          llmRequestOffset: 3,
          model: "openai/gpt-6.2-sol",
          outcome: "completed",
          inputTokens: 1000,
          outputTokens: 20,
          interpreted: true,
        },
        { kind: "code", requestOffset: 13, success: true, activitySummary: "Saying hello" },
      ],
    },
  ]);
  expect(JSON.stringify(items)).not.toContain("— Web UI");
});

test("while it runs: the request waits, the model thinks with no words, the answer streams, the script runs", () => {
  const live = (through: number) => foldAgentLog(undefined, exchange.slice(0, through)).state;
  expect(deriveAgentUiLiveStatus(live(8))).toMatchObject({ phase: "waiting" });
  expect(live(8).live?.steps).toMatchObject([{ kind: "llm", status: "running" }]);
  // the first frame says the model thinks, and has no words for it
  expect(deriveAgentUiLiveStatus(live(9))).toMatchObject({ phase: "thinking" });
  expect(live(9).live?.steps).toMatchObject([{ thinking: true, thinkingText: "" }]);
  // then its words for its thinking, then the answer
  expect(sliceText(stepOf(live(10)).thinkingText)).toBe("Saying hello.");
  expect(deriveAgentUiLiveStatus(live(11))).toMatchObject({ phase: "writing" });
  expect(sliceText(stepOf(live(11)).responseText)).toBe(ANSWER);
  // settled: the settled fact's text is the answer; a script is owed
  expect(deriveAgentUiLiveStatus(live(12))).toMatchObject({ phase: "processing" });
  expect(deriveAgentUiLiveStatus(live(14))).toMatchObject({ phase: "running" });
});

test.for([
  {
    name: "a failed request shows its reason, and the pause after it shows its own",
    result: {
      status: "failed",
      errorMessage: "HTTP 500 from the gateway",
      failureKind: "provider",
    },
    step: { outcome: "failed", errorMessage: "HTTP 500 from the gateway" },
  },
  {
    name: "a cancelled request says so, with the reason the agent gave",
    result: { status: "cancelled", reason: "interrupted-by-user-input", partialText: "<code" },
    step: {
      outcome: "cancelled",
      cancelReason: "interrupted-by-user-input",
      responseText: "<code",
    },
  },
])("$name", ({ result, step }) => {
  const log = [
    ...exchange.slice(0, 3),
    fact(4, "llm-request/settled", { llmRequestOffset: 3, attempt: 0, result }),
    fact(5, "agent/paused", { reason: "3 requests in a row failed" }),
  ];
  const { items } = reduceAgentFeed(log, true);
  expect(items).toMatchObject([
    { kind: "user" },
    { kind: "activity", steps: [{ kind: "llm", ...step }] },
    { kind: "stream-paused", reason: "3 requests in a row failed" },
  ]);
});

test("a summary or a side request is no step of the feed: the agent's answer is", () => {
  const log = [
    fact(1, "llm-request/requested", {
      model: "m",
      purpose: "summary",
      extends: null,
      itemsAdded: [],
    }),
    fact(2, "llm-request/settled", {
      llmRequestOffset: 1,
      attempt: 0,
      result: { status: "succeeded", text: "a summary", providerItems: [] },
    }),
    fact(3, "llm-request/requested", {
      model: "m",
      purpose: "side",
      extends: null,
      itemsAdded: [],
    }),
  ];
  expect(reduceAgentFeed(log, true)).toMatchObject({ items: [], state: { live: null } });
});

test("other inputs are drawn from their own `agent/context-added`; the platform's message() from its raw fact", () => {
  const log = [
    // Slack: its transcription names a raw fact on another context, and is drawn as it is
    fact(
      1,
      "agent/context-added",
      {
        role: "user",
        content: "hi\n\n— Slack: <@U1> in channel C1.",
        source: { path: "/integrations/slack/T1", offset: 40 },
      },
      MIND,
    ),
    // another agent's words: the stamp names the context that wrote them
    fact(
      2,
      "agent/context-added",
      { role: "user", content: "done: 42" },
      { origin: "/agents/planner" },
    ),
    // the platform's message(), context only, and its transcription
    fact(
      3,
      "agent/message-received",
      { message: "fyi", trigger: false },
      { origin: "/agents", onBehalfOf: { principal: ADA.principal } },
    ),
    fact(
      4,
      "agent/context-added",
      {
        role: "user",
        content: "fyi\n\n— Agents API: …",
        source: { path: PATH, offset: 3 },
        llmRequestPolicy: { behaviour: "dont-trigger-request" },
      },
      MIND,
    ),
  ];
  const { items } = reduceAgentFeed(log, true);
  expect(items).toMatchObject([
    { kind: "user", text: "hi\n\n— Slack: <@U1> in channel C1." },
    { kind: "user", text: "done: 42", from: "/agents/planner" },
    { kind: "background", messages: [{ text: "fyi", sender: { email: "ada@example.com" } }] },
  ]);
});

test("each other fact of the agent is one plain row: the trigger and its reason, a subagent, Slack", () => {
  const log = [
    fact(1, "agent/llm-request-triggered", { reason: "the morning schedule" }),
    fact(2, "agent/subagent-requested", { path: `${PATH}/hotel`, brief: "Book it." }),
    fact(3, "agent/subagent-started", { requestOffset: 2, path: `${PATH}/hotel`, copiedItems: 12 }),
    fact(4, "agent/subagent-requested", { path: `${PATH}/flight` }),
    fact(5, "agent/subagent-failed", { requestOffset: 4, error: "that path is taken" }),
    fact(6, "slack/message-sent", { requestOffset: 9, channel: "C1", text: "On it.", ts: "1.2" }),
    fact(7, "slack/message-failed", { requestOffset: 10, error: "channel_not_found" }),
    fact(8, "agent/resumed", {}),
  ];
  const { items } = reduceAgentFeed(log, true);
  expect(items).toMatchObject([
    { kind: "note", about: "request", text: "Asked for an answer: the morning schedule" },
    {
      kind: "note",
      about: "subagent",
      text: `Started a subagent at ${PATH}/hotel, with 12 items of this conversation`,
    },
    {
      kind: "note",
      about: "subagent",
      text: `A subagent at ${PATH}/flight did not start`,
      detail: "that path is taken",
      failed: true,
    },
    { kind: "note", about: "slack", text: "Sent a Slack message in C1", detail: "On it." },
    { kind: "note", about: "slack", detail: "channel_not_found", failed: true },
    { kind: "stream-resumed" },
  ]);
});

test("the composer: words and a file are ONE `agent-ui/message-received`, the file stored first under the message's key", async () => {
  const appended: unknown[][] = [];
  const stored: { files: unknown[]; key?: string }[] = [];
  const host = {
    onAppend: async (events: unknown[]) => appended.push(events),
    onMessage: async () => {
      throw new Error("no message() for this agent");
    },
    storeFiles: async (files: { filename: string }[], key?: string) => {
      stored.push({ files, key });
      return files.map((file) => ({ ...PNG, filename: file.filename }));
    },
  };
  await sendToAgent({ message: "look", files: [OUTGOING], key: "k1" }, host);
  expect(stored).toMatchObject([{ files: [OUTGOING], key: "k1" }]);
  expect(appended).toMatchObject([
    [
      {
        type: "events.iterate.com/agent-ui/message-received",
        idempotencyKey: "agent-ui/message-received:k1",
        payload: { message: "look", files: [PNG] },
      },
    ],
  ]);
});

test("the composer: a host that cannot store files sends words with files through message()", async () => {
  const sent: unknown[] = [];
  const appended: unknown[] = [];
  const host = {
    onAppend: async (events: unknown[]) => appended.push(events),
    onMessage: async (input: unknown) => void sent.push(input),
  };
  await sendToAgent({ message: "look", files: [OUTGOING], key: "k2" }, host);
  await sendToAgent({ message: "words", files: [], key: "k3" }, host);
  expect({ sent, appended }).toMatchObject({
    sent: [{ message: "look", files: [OUTGOING] }],
    appended: [[{ payload: { message: "words" } }]],
  });
});

// ── the log ──

const SCRIPT =
  'itx.append({ type: "events.iterate.com/agent-ui/message-sent", payload: { message: "Hello there." } });';
const ANSWER = `<codemode>\n${SCRIPT}\n</codemode>`;
const CODE = `async (__itx) => {\n//#region your script\n${SCRIPT}\n//#endregion your script\n}`;
const PNG = { contentType: "image/png", filename: "a.png", path: `${PATH}/0123-a.png`, size: 3 };
const OUTGOING = { contentType: "image/png", filename: "a.png", data: "AAAA" };

/** The live step of a fold. */
function stepOf(state: ReturnType<typeof foldAgentLog>["state"]) {
  const step = state.live?.steps[0];
  if (step?.kind !== "llm") throw new Error("no llm step");
  return step;
}

/** The Dash's words, their transcription, and the exchange that answers them. */
const exchange: LoggedEvent[] = [
  uiMessage(1, "hello"),
  transcription(
    2,
    1,
    `hello\n\n— Web UI: ada@example.com wrote this in the Dash. Raw event: offset 1 of ${PATH}.`,
  ),
  fact(3, "llm-request/requested", {
    model: "openai/gpt-6.2-sol",
    purpose: "answer",
    triggerOffset: 2,
    instructions: "…",
    extends: null,
    itemsAdded: [],
  }),
  fact(4, "itx/schedule-set", { key: "llm-request/requested:answer/1/deadline" }),
  fact(5, "itx/schedule-set", { key: "llm-request/requested:answer/1/wait" }),
  fact(6, "llm-request/attempt-started", {
    llmRequestOffset: 3,
    attempt: 0,
    api: "openai-responses",
    instanceId: "h",
    transport: "gateway",
    model: "openai/gpt-6.2-sol",
    inputChars: { words: 5 },
    inputFileBytes: 0,
  }),
  fact(7, "itx/schedule-cancelled", { key: "llm-request/requested:answer/1/wait" }),
  fact(8, "openai-responses/request-started", { llmRequestOffset: 3, attempt: 0 }),
  frame(9, 3, { sequence: 0, thinking: true }),
  frame(10, 3, { sequence: 1, thinkingDelta: "Saying hello.", thinking: true }),
  frame(11, 3, { sequence: 2, textDelta: ANSWER }),
  fact(12, "llm-request/settled", {
    llmRequestOffset: 3,
    attempt: 0,
    durationMs: 900,
    result: {
      status: "succeeded",
      text: ANSWER,
      providerItems: [],
      usage: { inputTokens: 1000, outputTokens: 20, cachedInputTokens: 400, costUsd: 0.00144 },
    },
  }),
  runRequested(13, 3, CODE),
  summary(14, "Saying hello"),
  sent(15, "Hello there."),
  runSettled(16, 13),
];
