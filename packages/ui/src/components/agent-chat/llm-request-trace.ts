// THE TRACE OF ONE REQUEST OF THE AGENT (agent-facts.ts), for every LLM: what the request asked
// (its model, its instructions, its conversation, rebuilt along its chain of bases), each attempt
// with THE EXACT BODY that went to the provider (from the request maker's own
// `<api>/request-started`, its conversation put back along `extendsRequestStartedOffset`), and
// what came back (the text, why it failed or was cancelled, what it cost). The API shape is the
// attempt's `api`: the trace reads that namespace and knows no provider by name. It reads only
// the log held: a fact older than the pages held is named as missing, never guessed.
//
// Each fact's payload is parsed once, by the schemas below. A field of the wrong shape reads as
// absent, so one odd field never hides the rest of a trace.
import { z } from "zod";
import { AGENT_FACT, apiFactType, scriptRequestOffsetOf, type StoredFile } from "./agent-facts.ts";
import type { StreamEvent } from "./stream-event.ts";

/** One item of the conversation, as the request names it. */
export type LlmRequestTraceItem = {
  role: string;
  text: string;
  files: StoredFile[];
  /** Where the item stands in the log, when the request says it. */
  atOffset?: number;
  /** What kind of item it is (`words`, `script-result`, `llm-response`…), when the request says it. */
  tag?: string;
};

/** The request's usage, as its settled fact gives it. */
export type LlmRequestUsage = {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  cacheWriteInputTokens?: number;
  reasoningOutputTokens?: number;
  costUsd?: number;
  /** The provider gave no count: the numbers are estimates. */
  estimated?: boolean;
};

/** One attempt: its API shape, its transport and its exact body. */
export type LlmRequestAttempt = {
  attempt: number;
  /** The API shape's name, which is the namespace of its facts. */
  api: string | null;
  transport?: string;
  model?: string;
  startedAtMs: number;
  inputChars?: Record<string, number>;
  inputFileBytes?: number;
  /** THE EXACT BODY, in the provider's own form. Each string that held a file's bytes is
   *  `{ "$file": { path, contentType, sha256, bytes, as } }`. Null when it cannot be rebuilt from
   *  the log held: `bodyMissing` says why. */
  body: Record<string, unknown> | null;
  bodyMissing?: string;
  /** The SHA-256 of the real body's JSON, the files' bytes included. */
  bodySha256?: string;
};

export type LlmRequestOutcome =
  | { status: "in flight" }
  | { status: "succeeded"; text: string; durationMs?: number; firstEventMs?: number }
  | {
      status: "failed";
      errorMessage: string;
      failureKind?: string;
      partialText?: string;
      durationMs?: number;
    }
  | { status: "cancelled"; reason?: string; partialText?: string; durationMs?: number };

export type LlmRequestTrace = {
  llmRequestOffset: number;
  model: string;
  /** `answer`, `summary` or `side`. */
  purpose: string;
  requestedAtMs: number;
  /** Null: the request and every base it names say none, or the base that does is not held. */
  instructions: string | null;
  conversation: LlmRequestTraceItem[];
  /** False: a base of the request is not in the log held, so the conversation lacks its items. */
  conversationWhole: boolean;
  attempts: LlmRequestAttempt[];
  outcome: LlmRequestOutcome;
  usage?: LlmRequestUsage;
  /** The runs of the scripts that the response wrote (`itx/run-requested` offsets). */
  scriptRequestOffsets: number[];
};

/** How many bases a chain may have before the trace stops reading it: the request maker's own
 *  bound (llm-api.ts `MAX_BASE_READS`). */
const MAX_CHAIN = 64;

// ── the facts' payloads ──

const maybeNumber = z.number().optional().catch(undefined);
const maybeText = z.string().optional().catch(undefined);
const JSONObject = z.record(z.string(), z.unknown());

const MessageFile = z.object({
  contentType: z.string(),
  filename: z.string(),
  path: z.string(),
  size: z.number(),
});

/** A message's files: a file of the wrong shape is left out. */
const Files = z
  .array(MessageFile.nullable().catch(null))
  .catch([])
  .transform((files) => files.flatMap((file) => (file ? [file] : [])));

/** An item of `llm-request/requested`'s `itemsAdded`. */
const RequestedItem = z
  .object({
    role: maybeText,
    text: maybeText,
    files: Files.optional(),
    atOffset: maybeNumber,
    tag: maybeText,
  })
  .catch({});

/** `llm-request/requested`. */
const Requested = z.object({
  model: maybeText,
  purpose: maybeText,
  instructions: maybeText,
  extends: z
    .object({
      llmRequestOffset: z.number(),
      itemCount: z.number().nullable().optional().catch(undefined),
      response: z.boolean().optional().catch(undefined),
    })
    .nullable()
    .catch(null),
  itemsAdded: z.array(RequestedItem).catch([]),
});

const Usage = z.object({
  inputTokens: maybeNumber,
  outputTokens: maybeNumber,
  cachedInputTokens: maybeNumber,
  cacheWriteInputTokens: maybeNumber,
  reasoningOutputTokens: maybeNumber,
  costUsd: maybeNumber,
  estimated: z.literal(true).optional().catch(undefined),
});

/** `llm-request/settled`. A result of no known shape reads as a cancelled one. */
const Settled = z.object({
  llmRequestOffset: z.number(),
  durationMs: maybeNumber,
  firstEventMs: maybeNumber,
  result: z
    .object({
      status: maybeText,
      text: maybeText,
      partialText: maybeText,
      errorMessage: maybeText,
      failureKind: maybeText,
      reason: maybeText,
      usage: Usage.optional().catch(undefined),
    })
    .catch({}),
});
type Settled = z.infer<typeof Settled>;

/** `llm-request/attempt-started`. */
const AttemptStarted = z.object({
  llmRequestOffset: maybeNumber,
  attempt: z.number().catch(0),
  api: maybeText,
  transport: maybeText,
  model: maybeText,
  inputChars: z.record(z.string(), z.number()).optional().catch(undefined),
  inputFileBytes: maybeNumber,
});

/** `<api>/request-started`: the body without its conversation, and the conversation as the items
 *  it adds to the body it extends. */
const RequestStarted = z.object({
  llmRequestOffset: maybeNumber,
  attempt: maybeNumber,
  bodySha256: maybeText,
  inputField: maybeText,
  bodyWithoutInput: JSONObject.optional().catch(undefined),
  inputItemsAdded: z.array(z.unknown()).optional().catch(undefined),
  extendsRequestStartedOffset: z.number().nullable().optional().catch(undefined),
  inputItemCountBefore: z.number().catch(0),
});
type RequestStarted = z.infer<typeof RequestStarted>;

// ── the trace ──

/** The trace of the request at `llmRequestOffset`, or null when that offset holds no request of
 *  the agent in the log held. */
export function llmRequestTrace(
  events: readonly StreamEvent[],
  llmRequestOffset: number,
): LlmRequestTrace | null {
  const byOffset = new Map(events.map((event) => [event.offset, event]));
  const requested = byOffset.get(llmRequestOffset);
  if (!requested || requested.type !== AGENT_FACT.llmRequested) return null;
  const payload = Requested.safeParse(requested.payload).data;
  const settledByRequest = new Map<number, Settled>();
  const attemptsStarted: StreamEvent[] = [];
  const scriptRequestOffsets: number[] = [];
  for (const event of events) {
    if (event.type === AGENT_FACT.llmSettled) {
      const settled = Settled.safeParse(event.payload).data;
      if (settled && !settledByRequest.has(settled.llmRequestOffset))
        settledByRequest.set(settled.llmRequestOffset, settled);
    }
    if (
      event.type === AGENT_FACT.llmAttemptStarted &&
      AttemptStarted.safeParse(event.payload).data?.llmRequestOffset === llmRequestOffset
    )
      attemptsStarted.push(event);
    if (
      event.type === "events.iterate.com/itx/run-requested" &&
      scriptRequestOffsetOf(event.idempotencyKey) === llmRequestOffset
    )
      scriptRequestOffsets.push(event.offset);
  }
  const asked = askedOf(byOffset, settledByRequest, llmRequestOffset, 0);
  const settled = settledByRequest.get(llmRequestOffset);
  return {
    llmRequestOffset,
    model: payload?.model || "?",
    purpose: payload?.purpose || "?",
    requestedAtMs: Date.parse(requested.createdAt),
    instructions: asked.instructions || null,
    conversation: asked.items,
    conversationWhole: asked.whole,
    attempts: attemptsStarted.map((event) => attemptOf(events, byOffset, event)),
    outcome: outcomeOf(settled),
    usage: settled?.result.usage,
    scriptRequestOffsets,
  };
}

/** What the request at `offset` asked: its instructions and its conversation, along its bases. */
function askedOf(
  byOffset: ReadonlyMap<number, StreamEvent>,
  settledByRequest: ReadonlyMap<number, Settled>,
  offset: number,
  depth: number,
): { instructions?: string; items: LlmRequestTraceItem[]; whole: boolean } {
  const event = byOffset.get(offset);
  if (!event || event.type !== AGENT_FACT.llmRequested || depth > MAX_CHAIN)
    return { items: [], whole: false };
  const payload = Requested.safeParse(event.payload).data;
  const added = (payload?.itemsAdded || []).map((item): LlmRequestTraceItem => ({
    role: item.role || "?",
    text: item.text || "",
    files: item.files || [],
    // an item with no place stands at the request
    atOffset: item.atOffset ?? offset,
    tag: item.tag || "words",
  }));
  const instructions = payload?.instructions;
  const base = payload?.extends;
  if (!base) return { instructions, items: added, whole: true };
  const below = askedOf(byOffset, settledByRequest, base.llmRequestOffset, depth + 1);
  const count = base.itemCount ?? below.items.length;
  const answer = base.response ? responseOf(settledByRequest, base.llmRequestOffset) : [];
  return {
    instructions: instructions || below.instructions,
    items: [...below.items.slice(0, count), ...answer, ...added],
    whole: below.whole && count <= below.items.length && (!base.response || answer.length > 0),
  };
}

/** The base's response as one item, from its settled fact, when it succeeded. */
function responseOf(
  settledByRequest: ReadonlyMap<number, Settled>,
  offset: number,
): LlmRequestTraceItem[] {
  const result = settledByRequest.get(offset)?.result;
  if (result?.status !== "succeeded" || !result.text) return [];
  return [
    { role: "assistant", text: result.text, files: [], atOffset: offset, tag: "llm-response" },
  ];
}

/** One attempt, with its body from the request maker's own fact. */
function attemptOf(
  events: readonly StreamEvent[],
  byOffset: ReadonlyMap<number, StreamEvent>,
  started: StreamEvent,
): LlmRequestAttempt {
  const p = AttemptStarted.parse(started.payload);
  const api = p.api || null;
  const base = {
    attempt: p.attempt,
    api,
    transport: p.transport,
    model: p.model,
    startedAtMs: Date.parse(started.createdAt),
    inputChars: p.inputChars,
    inputFileBytes: p.inputFileBytes,
  };
  if (!api) return { ...base, body: null, bodyMissing: "The attempt names no API shape." };
  const type = apiFactType(api, "request-started");
  const fact = events
    .filter((event) => event.type === type)
    .map((event) => RequestStarted.safeParse(event.payload).data)
    .find((q) => q?.llmRequestOffset === p.llmRequestOffset && q?.attempt === p.attempt);
  if (!fact)
    return {
      ...base,
      body: null,
      bodyMissing: `No ${api}/request-started for this attempt in the log held.`,
    };
  const withSha = { ...base, bodySha256: fact.bodySha256 };
  const input = inputOf(byOffset, type, fact, 0);
  if (typeof input === "string") return { ...withSha, body: null, bodyMissing: input };
  if (!fact.inputField || !fact.bodyWithoutInput)
    return { ...withSha, body: null, bodyMissing: "The fact has no body." };
  return { ...withSha, body: { ...fact.bodyWithoutInput, [fact.inputField]: input } };
}

/** The conversation of a body, put back along the chain of the facts it extends: the first
 *  `inputItemCountBefore` items of the fact it extends, then `inputItemsAdded`. A string: why it
 *  cannot be put back from the log held. */
function inputOf(
  byOffset: ReadonlyMap<number, StreamEvent>,
  type: string,
  fact: RequestStarted,
  depth: number,
): unknown[] | string {
  if (!fact.inputItemsAdded)
    return "Its conversation was too large for one fact: the request facts before it give it.";
  const extended = fact.extendsRequestStartedOffset;
  // no request-started stands at offset 0: a stream's first fact is its own creation
  if (!extended) return fact.inputItemsAdded;
  const earlier = byOffset.get(extended);
  const earlierFact = earlier?.type === type && RequestStarted.safeParse(earlier.payload).data;
  if (!earlierFact || depth > MAX_CHAIN)
    return `It extends the body at offset ${String(extended)}, which is not in the log held.`;
  const before = inputOf(byOffset, type, earlierFact, depth + 1);
  if (typeof before === "string") return before;
  return [...before.slice(0, fact.inputItemCountBefore), ...fact.inputItemsAdded];
}

function outcomeOf(settled: Settled | undefined): LlmRequestOutcome {
  if (!settled) return { status: "in flight" };
  const { result, durationMs } = settled;
  if (result.status === "succeeded")
    return {
      status: "succeeded",
      text: result.text || "",
      durationMs,
      firstEventMs: settled.firstEventMs,
    };
  if (result.status === "failed")
    return {
      status: "failed",
      errorMessage: result.errorMessage || "",
      failureKind: result.failureKind,
      partialText: result.partialText,
      durationMs,
    };
  return {
    status: "cancelled",
    reason: result.reason,
    partialText: result.partialText,
    durationMs,
  };
}
