// The trace of a request of the agent (llm-request-trace.ts), for each API shape and for one the
// chat has never heard of: the instructions and the conversation along the chain of bases, each
// attempt's exact body put back along `extendsRequestStartedOffset`, the response and its usage.
// The sheet that draws it is out of scope.
import { expect, test } from "vitest";
import { llmRequestTrace } from "./llm-request-trace.ts";
import type { StreamEvent } from "./stream-event.ts";

test.for([
  {
    name: "openai-responses",
    bodyWithoutInput: { model: "gpt-6.2-sol", instructions: "Be brief.", stream: true },
    inputField: "input",
    asked: { role: "user", content: [{ type: "input_text", text: "hello" }] },
    answered: {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "hi" }],
    },
    again: { role: "user", content: [{ type: "input_text", text: "and now?" }] },
  },
  {
    name: "anthropic-messages",
    bodyWithoutInput: { model: "claude-opus-5.5", system: "Be brief.", max_tokens: 8000 },
    inputField: "messages",
    asked: { role: "user", content: [{ type: "text", text: "hello" }] },
    answered: { role: "assistant", content: [{ type: "text", text: "hi" }] },
    again: { role: "user", content: [{ type: "text", text: "and now?" }] },
  },
  {
    name: "chat-completions",
    bodyWithoutInput: { model: "grok-4.3", stream: true },
    inputField: "messages",
    asked: { role: "user", content: "hello" },
    answered: { role: "assistant", content: "hi" },
    again: { role: "user", content: "and now?" },
  },
  {
    name: "google-generate-content",
    bodyWithoutInput: { systemInstruction: { parts: [{ text: "Be brief." }] } },
    inputField: "contents",
    asked: { role: "user", parts: [{ text: "hello" }] },
    answered: { role: "model", parts: [{ text: "hi" }] },
    again: { role: "user", parts: [{ text: "and now?" }] },
  },
  {
    // a request maker the chat has never heard of: its namespace is the attempt's `api`
    name: "basement-llm",
    bodyWithoutInput: { preamble: "Be brief." },
    inputField: "lines",
    asked: "user: hello",
    answered: "assistant: hi",
    again: "user: and now?",
  },
])(
  "$name: the request, its conversation along its base, each attempt's exact body, what came back",
  ({ name: api, bodyWithoutInput, inputField, asked, answered, again }) => {
    const log = chain(api, { bodyWithoutInput, inputField, asked, answered, again });
    expect(llmRequestTrace(log, 10)).toMatchObject({
      llmRequestOffset: 10,
      model: "m/x",
      purpose: "answer",
      instructions: "Be brief.",
      conversationWhole: true,
      conversation: [
        { role: "user", text: "hello", files: [PNG], atOffset: 1, tag: "words" },
        { role: "assistant", text: "hi", tag: "llm-response", atOffset: 2 },
        { role: "user", text: "and now?", atOffset: 9 },
      ],
      attempts: [
        // the first attempt failed part way; the second went out again, the same body
        {
          attempt: 0,
          api,
          transport: "gateway",
          body: { ...bodyWithoutInput, [inputField]: [asked, answered, again] },
          bodySha256: "sha-2",
        },
        { attempt: 1, api, body: { ...bodyWithoutInput, [inputField]: [asked, answered, again] } },
      ],
      outcome: { status: "succeeded", text: "fine", durationMs: 700 },
      usage: { inputTokens: 900, cachedInputTokens: 800, outputTokens: 3, costUsd: 0.0012 },
      scriptRequestOffsets: [16],
    });
  },
);

test("a base older than the log held: the conversation says it lacks items, and a body that extends one is named as missing", () => {
  const log = chain("chat-completions", {
    bodyWithoutInput: {},
    inputField: "messages",
    asked: "a",
    answered: "b",
    again: "c",
  }).filter((event) => event.offset > 8);
  expect(llmRequestTrace(log, 10)).toMatchObject({
    instructions: null,
    conversationWhole: false,
    conversation: [{ role: "user", text: "and now?" }],
    attempts: [
      { body: null, bodyMissing: "It extends the body at offset 5, which is not in the log held." },
      { body: null },
    ],
  });
});

test("a request in flight, a failed one, a cancelled one: what came back so far, and why", () => {
  const whole = { model: "m/x", purpose: "side", extends: null, itemsAdded: [] };
  const log = [
    fact(1, "llm-request/requested", whole),
    fact(2, "llm-request/requested", whole),
    fact(3, "llm-request/settled", {
      llmRequestOffset: 2,
      attempt: 0,
      result: {
        status: "failed",
        errorMessage: "HTTP 500",
        failureKind: "provider",
        partialText: "<co",
      },
    }),
    fact(4, "llm-request/requested", whole),
    fact(5, "llm-request/settled", {
      llmRequestOffset: 4,
      attempt: 0,
      result: { status: "cancelled", reason: "superseded" },
    }),
  ];
  expect([1, 2, 4].map((offset) => llmRequestTrace(log, offset))).toMatchObject([
    { purpose: "side", outcome: { status: "in flight" }, attempts: [] },
    {
      outcome: {
        status: "failed",
        errorMessage: "HTTP 500",
        failureKind: "provider",
        partialText: "<co",
      },
    },
    { outcome: { status: "cancelled", reason: "superseded" } },
  ]);
  // no request of the agent at that offset
  expect(llmRequestTrace(log, 3)).toBe(null);
});

// ── the log ──

const PATH = "/agents/people/ada/agent/x";
const PNG = { contentType: "image/png", filename: "a.png", path: `${PATH}/0123-a.png`, size: 3 };

/** Two requests on one chain, of the API shape `api`: the first asked "hello" with a picture and
 *  got "hi"; the second extends it, its response included, and asks "and now?". The second has two
 *  attempts; its first attempt's body extends the first request's body. */
function chain(
  api: string,
  shape: {
    bodyWithoutInput: Record<string, unknown>;
    inputField: string;
    asked: unknown;
    answered: unknown;
    again: unknown;
  },
): StreamEvent[] {
  const started = (offset: number, llmRequestOffset: number, attempt: number, payload: object) =>
    fact(offset, `${api}/request-started`, {
      llmRequestOffset,
      attempt,
      model: "m/x",
      transport: "gateway",
      bodyWithoutInput: shape.bodyWithoutInput,
      inputField: shape.inputField,
      ...payload,
    });
  const attempt = (offset: number, llmRequestOffset: number, n: number) =>
    fact(offset, "llm-request/attempt-started", {
      llmRequestOffset,
      attempt: n,
      api,
      instanceId: "h",
      transport: "gateway",
      model: "m/x",
      inputChars: { words: 5 },
      inputFileBytes: 3,
    });
  return [
    fact(1, "agent-ui/message-received", { message: "hello", files: [PNG] }),
    fact(2, "llm-request/requested", {
      model: "m/x",
      purpose: "answer",
      instructions: "Be brief.",
      extends: null,
      itemsAdded: [
        { atOffset: 1, rank: 0, tag: "words", role: "user", text: "hello", files: [PNG] },
      ],
    }),
    attempt(4, 2, 0),
    started(5, 2, 0, {
      extendsRequestStartedOffset: null,
      inputItemCountBefore: 0,
      inputItemsAdded: [shape.asked],
      bodySha256: "sha-1",
    }),
    fact(6, "llm-request/settled", {
      llmRequestOffset: 2,
      attempt: 0,
      result: { status: "succeeded", text: "hi", providerItems: [] },
    }),
    fact(9, "agent/context-added", { role: "user", content: "and now?" }),
    fact(10, "llm-request/requested", {
      model: "m/x",
      purpose: "answer",
      extends: { llmRequestOffset: 2, itemCount: null, response: true },
      itemsAdded: [{ atOffset: 9, rank: 0, tag: "words", role: "user", text: "and now?" }],
    }),
    attempt(11, 10, 0),
    started(12, 10, 0, {
      extendsRequestStartedOffset: 5,
      inputItemCountBefore: 1,
      inputItemsAdded: [shape.answered, shape.again],
      bodySha256: "sha-2",
    }),
    attempt(13, 10, 1),
    started(14, 10, 1, {
      extendsRequestStartedOffset: 12,
      inputItemCountBefore: 3,
      inputItemsAdded: [],
      bodySha256: "sha-2",
    }),
    fact(15, "llm-request/settled", {
      llmRequestOffset: 10,
      attempt: 1,
      durationMs: 700,
      result: {
        status: "succeeded",
        text: "fine",
        providerItems: [],
        usage: { inputTokens: 900, cachedInputTokens: 800, outputTokens: 3, costUsd: 0.0012 },
      },
    }),
    fact(
      16,
      "itx/run-requested",
      { code: "return 1;" },
      { idempotencyKey: "agent/script-run:10/0" },
    ),
  ];
}

/** A committed fact of the agent's log. */
function fact(
  offset: number,
  type: string,
  payload: object,
  more: Partial<StreamEvent> = {},
): StreamEvent {
  return {
    offset,
    type: `events.iterate.com/${type}`,
    createdAt: new Date(Date.UTC(2026, 10, 23, 12, 0, offset)).toISOString(),
    path: PATH,
    payload,
    source: { origin: PATH },
    ...more,
  };
}
