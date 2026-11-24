// The agent-UI reducer (agent-ui-reducer.ts) over the facts of the mind's own agent
// (test-support/agent-log.ts): a person's words, a request whose windows stream and which settles,
// the context's script run, the agent's words, must reduce into the chat items and the live tail
// the agent feed renders.
import { expect, test } from "vitest";
import { RUN_DEADLINE_MS } from "iterate/stream/run";
import { appendText, sliceText } from "./chunked-text.ts";
import type { StreamEvent } from "./stream-event.ts";
import {
  deriveAgentUiLiveStatus,
  initialAgentUiState,
  reduceAgentUi,
  settleAgentUiAtIdleBoundary,
  summarizeAgentUiActivity,
  type AgentUiActivity,
  type AgentUiItem,
} from "./agent-ui-reducer.ts";
import {
  apiMessage,
  cancelled,
  fact,
  failed,
  frame,
  paused,
  request,
  resumed,
  runRequested,
  runSettled,
  said,
  sent,
  settled,
  succeeded,
  summary,
  timeOf,
  transcription,
} from "#/test-support/agent-log.ts";

test("a person's message says who said it in a short name, and never the page it came through: their own append, their call into the agent's facet from an app's page, their script", () => {
  const principal = { actor: "user:1", email: "ada@example.com" };
  const state = reduceAll([
    said(1, "hello", { source: { principal } }),
    said(2, "hello", {
      source: { onBehalfOf: { principal, via: { appPage: "agents.example.com" } } },
    }),
    said(3, "hello", { source: { onBehalfOf: { principal: { actor: "user:2" }, run: "/@7" } } }),
    said(4, "hello", { source: {} }),
  ]);
  expect(state.items.map((item) => item.kind === "user" && item.saidBy)).toEqual([
    "ada",
    "ada",
    "user:2 (a script)",
    undefined,
  ]);
});

test("a person's message says who sent it as data: their actor, their address, and whether a script wrote it; an event that names nobody says no one", () => {
  const state = reduceAll([
    said(1, "hello", { source: { principal: { actor: "user:1", email: "ada@example.com" } } }),
    said(2, "hello", { source: { onBehalfOf: { principal: { actor: "user:2" }, run: "/@7" } } }),
    said(3, "hello", { source: {} }),
  ]);
  expect(state.items.map((item) => item.kind === "user" && item.sender)).toEqual([
    { actor: "user:1", email: "ada@example.com", script: false },
    { actor: "user:2", script: true },
    undefined,
  ]);
});

test("a message sent with message() keeps who said it on the bubble its transcription draws, in the message's own words", () => {
  const principal = { actor: "user:1", email: "ada@example.com" };
  const state = reduceAll([
    apiMessage(7, "hello", {
      source: { onBehalfOf: { principal, via: { appPage: "agents.example.com" } } },
    }),
    transcription(8, 7, "hello\n\n— Agents API: ada@example.com sent this."),
  ]);
  expect(state.items).toMatchObject([
    {
      kind: "user",
      offset: 8,
      text: "hello",
      saidBy: "ada",
      sender: { ...principal, script: false },
    },
  ]);
});

test("a subagent's report keeps the context that sent it on the bubble its transcription draws, and starts the same turn", () => {
  const report = [
    apiMessage(7, "The site is up.", {
      source: { origin: "/agents" },
      from: "/agents/onboarding/website",
    }),
    transcription(8, 7, "[from /agents/onboarding/website] The site is up."),
    request(9),
  ];
  const state = reduceAll(report);
  expect(state.items).toMatchObject([
    { kind: "user", id: "user-8", text: "The site is up.", from: "/agents/onboarding/website" },
  ]);
  // the same events with no `from` fold to the same turn: the sender changes the row, not the fold
  const unsigned = reduceAll([
    apiMessage(7, "The site is up.", { source: { origin: "/agents" } }),
    ...report.slice(1),
  ]);
  expect(state).toMatchObject({ live: unsigned.live });
  expect(state.items.map(({ id, kind }) => ({ id, kind }))).toEqual(
    unsigned.items.map(({ id, kind }) => ({ id, kind })),
  );
});

test.for([
  { name: "the root, the mind's code and its people", from: "/" },
  { name: "no context path", from: "website" },
  { name: "no string", from: 7 },
])("a `from` of $name is a person's message, with no sender context", ({ from }) => {
  const state = reduceAll([
    fact(1, "agent/message-received", { message: "hello", from }, { origin: "/agents" }),
    transcription(2, 1, "hello"),
  ]);
  expect(state.items).toMatchObject([{ kind: "user", text: "hello", from: undefined }]);
});

test("a message that starts no turn keeps the context that sent it on its background message", () => {
  const state = reduceAll([
    apiMessage(1, "fyi", {
      source: { origin: "/agents" },
      from: "/agents/onboarding/look",
      trigger: false,
    }),
    transcription(2, 1, "fyi", { llmRequestPolicy: { behaviour: "dont-trigger-request" } }),
  ]);
  expect(state.items).toMatchObject([
    { kind: "background", messages: [{ text: "fyi", from: "/agents/onboarding/look" }] },
  ]);
});

test("streams thinking and response deltas into the live llm step", () => {
  const state = reduceAll([
    said(1, "count the inputs"),
    request(10, { model: "gpt-test" }),
    frame(11, 10, { thinkingDelta: "Reading the stream", thinking: true }),
    frame(12, 10, { textDelta: "const n = await " }),
    frame(13, 10, { textDelta: "stream.count();" }),
  ]);

  expect(state.items).toHaveLength(1);
  expect(state.items[0]).toMatchObject({ kind: "user", text: "count the inputs" });
  expect(state.live).not.toBeNull();
  expect(state.live?.steps).toHaveLength(1);
  expect(state.live?.steps[0]).toMatchObject({
    kind: "llm",
    status: "running",
    model: "gpt-test",
    thinkingText: appendText("", "Reading the stream"),
    responseText: appendText(appendText("", "const n = await "), "stream.count();"),
  });
});

test("a window that adds thinking and text at once streams both into the live llm step", () => {
  const state = reduceAll([
    said(1, "count the inputs"),
    request(10, { model: "gpt-test" }),
    frame(11, 10, { textDelta: "const n = await ", thinkingDelta: "Reading the stream" }),
    frame(12, 10, { textDelta: "stream.count();" }),
  ]);

  expect(state.live?.steps[0]).toMatchObject({
    kind: "llm",
    status: "running",
    thinkingText: appendText("", "Reading the stream"),
    responseText: appendText(appendText("", "const n = await "), "stream.count();"),
  });
});

test("a succeeded settle's text extends streamed windows when the tail flush was lost", () => {
  const state = reduceAll([
    said(1, "go"),
    request(10, { model: "gpt-test" }),
    frame(11, 10, { textDelta: "The lighthouse" }),
    // The tail flush was swallowed; the settled result carries the full text the windows never
    // received.
    settled(12, 10, succeeded("The lighthouse keeper")),
  ]);

  expect(state.live?.steps[0]).toMatchObject({
    kind: "llm",
    outcome: "completed",
    responseText: "The lighthouse keeper",
  });
});

test("a cancelled settle's partialText extends streamed windows with the unflushed tail", () => {
  const state = reduceAll([
    said(1, "go"),
    request(10, { model: "gpt-test" }),
    frame(11, 10, { textDelta: "The lighthouse" }),
    // The interrupt stranded " keeper" in the coalescing buffer — it never flushed, but the
    // settled fact carries the full partial.
    settled(12, 10, cancelled("interrupted-by-user-input", "The lighthouse keeper")),
  ]);

  const step =
    state.live?.steps[0] ??
    state.items.flatMap((item) => (item.kind === "activity" ? item.steps : []))[0];
  expect(step).toMatchObject({
    kind: "llm",
    outcome: "cancelled",
    responseText: "The lighthouse keeper",
  });
});

test("the next attempt's answer replaces what a failed attempt streamed, and a late window of the failed one shows nothing", () => {
  const state = reduceAll([
    said(1, "go"),
    request(10, { model: "gpt-test" }),
    frame(11, 10, { thinkingDelta: "Weighing it" }),
    frame(12, 10, { textDelta: "Half an ans" }),
    frame(13, 10, { attempt: 1, textDelta: "Counting" }),
    // the failed attempt's last window, delivered late
    frame(14, 10, { textDelta: "wer" }),
    frame(15, 10, { attempt: 1, textDelta: " now.", thinkingDelta: "Counted" }),
  ]);

  const step = state.live?.steps[0];
  if (step?.kind !== "llm") throw new Error("expected the llm step");
  expect({
    attempt: step.attempt,
    response: sliceText(step.responseText),
    thinking: sliceText(step.thinkingText),
  }).toEqual({ attempt: 1, response: "Counting now.", thinking: "Counted" });
});

test("settles the activity into items when all work completes", () => {
  const state = reduceAll([
    said(1, "hi"),
    request(2, { model: "gpt-test" }),
    settled(3, 2, succeeded("…", { inputTokens: 9400, outputTokens: 300 }), {
      durationMs: 2100,
    }),
    runRequested(4, 2, "await stream.read()"),
    runSettled(5, 4, { status: "succeeded", result: 12 }),
    sent(6, "There are 12 inputs."),
  ]);

  expect(state.live).toBeNull();
  expect(state.items.map((item) => item.kind)).toEqual(["user", "activity", "assistant"]);
  const activity = state.items[1];
  if (activity?.kind !== "activity") throw new Error("expected activity item");
  expect(activity).toMatchObject({ status: "done" });
  expect(activity.steps).toHaveLength(2);
  expect(activity.steps[0]).toMatchObject({
    kind: "llm",
    status: "done",
    inputTokens: 9400,
    outputTokens: 300,
    durationMs: 2100,
    outcome: "completed",
  });
  expect(activity.steps[1]).toMatchObject({
    kind: "code",
    requestOffset: 4,
    status: "done",
    code: "await stream.read()",
    result: 12,
    success: true,
    durationMs: 1000,
  });
});

test("a run the context's restart interrupted shows the platform's error, not an invalid settlement", () => {
  const state = settleAtIdle(
    reduceAll([
      request(1, { model: "gpt-test" }),
      settled(2, 1, succeeded("ok"), { durationMs: 100 }),
      runRequested(3, 1, "await stream.read()"),
      runSettled(4, 3, {
        status: "failed",
        error: "the context restarted before the script finished",
        failureKind: "interrupted",
      }),
    ]),
  );
  const activity = state.items.find((item) => item.kind === "activity");
  if (activity?.kind !== "activity") throw new Error("expected activity item");
  expect(activity.steps[1]).toMatchObject({
    kind: "code",
    success: false,
    errorMessage: "the context restarted before the script finished",
  });
});

test("stamps the summary activity onto the running code step as it lands", () => {
  const state = reduceAll([
    request(1, { model: "gpt-test" }),
    settled(2, 1),
    runRequested(3, 1),
    summary(4, "Searching the five most recent emails"),
  ]);

  expect(state).toMatchObject({ summaryActivity: "Searching the five most recent emails" });
  expect(state.live?.steps.at(-1)).toMatchObject({
    kind: "code",
    status: "running",
    activitySummary: "Searching the five most recent emails",
  });
});

test("a round that never updates the summary inherits the stream status as of that round", () => {
  const state = reduceAll([
    request(1, { model: "gpt-test" }),
    settled(2, 1),
    runRequested(3, 1, "await round1()"),
    summary(4, "Running script 1 of 2"),
    runSettled(5, 3, { status: "succeeded", result: 1 }),
    runRequested(6, 1, "await round2()", 1),
    runSettled(7, 6, { status: "succeeded", result: 2 }),
    runRequested(8, 1, "await round3()", 2),
  ]);

  const codeSteps = state.live?.steps.filter((step) => step.kind === "code");
  expect(codeSteps).toMatchObject([
    { requestOffset: 3, activitySummary: "Running script 1 of 2" },
    // The second script appended no summary — the round's status is whatever
    // the stream's summary said as of that round.
    { requestOffset: 6, activitySummary: "Running script 1 of 2" },
    // The third inherits from BIRTH, so the live header carries the status
    // too — not only settled rounds.
    { requestOffset: 8, status: "running", activitySummary: "Running script 1 of 2" },
  ]);
});

test("a request that succeeded closes its step", () => {
  const state = reduceAll([
    said(1, "hi"),
    request(5, { model: "gpt-test" }),
    settled(6, 5, succeeded("done", { inputTokens: 9400, outputTokens: 300 }), {
      durationMs: 2100,
    }),
    sent(7, "There are 12 inputs."),
  ]);

  expect(state.live).toBeNull();
  expect(state.items.map((item) => item.kind)).toEqual(["user", "activity", "assistant"]);
  const activity = state.items[1];
  if (activity?.kind !== "activity") throw new Error("expected activity item");
  expect(activity.steps[0]).toMatchObject({
    kind: "llm",
    status: "done",
    outcome: "completed",
    durationMs: 2100,
    inputTokens: 9400,
    outputTokens: 300,
  });
});

test("a request that failed or was cancelled settles its step with that outcome", () => {
  const failedRequest = reduceAll([
    request(5, { model: "gpt-test" }),
    settled(6, 5, failed("model exploded")),
  ]);
  expect(failedRequest.live?.steps[0]).toMatchObject({
    kind: "llm",
    status: "done",
    outcome: "failed",
    errorMessage: "model exploded",
  });

  const interrupted = reduceAll([
    request(5, { model: "gpt-test" }),
    settled(6, 5, cancelled("interrupted-by-user-input", "Hel")),
  ]);
  expect(interrupted.live?.steps[0]).toMatchObject({
    kind: "llm",
    status: "done",
    outcome: "cancelled",
    cancelReason: "interrupted-by-user-input",
  });

  const expired = reduceAll([
    request(5, { model: "gpt-test" }),
    settled(6, 5, cancelled("expired")),
  ]);
  expect(expired.live?.steps[0]).toMatchObject({
    kind: "llm",
    status: "done",
    outcome: "cancelled",
    cancelReason: "expired",
  });
});

test("keeps running script source, start time and deadline in the live activity", () => {
  const state = reduceAll([
    runRequested(1, null, "await itx.repo.readFile({ path: 'README.md' })"),
  ]);

  expect(state.items).toHaveLength(0);
  expect(state.live?.steps).toHaveLength(1);
  const startedAtMs = timeOf(1);
  expect(state.live?.steps[0]).toMatchObject({
    kind: "code",
    id: "code-1",
    requestOffset: 1,
    status: "running",
    code: "await itx.repo.readFile({ path: 'README.md' })",
    startedAtMs,
    // the platform settles a run still going then `deadline` — the feed counts down to it
    deadlineAtMs: startedAtMs + RUN_DEADLINE_MS,
  });
});

test("does not guess which script a settlement without its request's offset belongs to", () => {
  const state = reduceAll([
    runRequested(1, null, "async () => mutate()"),
    fact(2, "itx/run-settled", { settlement: { status: "succeeded", result: "wrong target" } }),
  ]);

  expect(state.live?.steps).toMatchObject([{ kind: "code", requestOffset: 1, status: "running" }]);
});

test("does not derive agent state or durations from a malformed event timestamp", () => {
  const state = reduceAll([
    runRequested(1, null, "async () => mutate()"),
    {
      ...runSettled(2, 1, { status: "succeeded", result: "must be ignored" }),
      createdAt: "not-a-timestamp",
    },
  ]);

  expect(state.live?.steps).toMatchObject([{ kind: "code", requestOffset: 1, status: "running" }]);
});

test("a run request RunRequested refuses (no code) is no step", () => {
  const state = reduceAll([fact(1, "itx/run-requested", { code: "" })]);

  expect(state).toMatchObject({ items: [] });
  expect(state.live).toBeNull();
});

test("a running script's chat message shows at once and the live indicator stays", () => {
  const script =
    "await itx.append({ type: 'events.iterate.com/agent-ui/message-sent', payload: { message: '20' } });\nawait new Promise((resolve) => setTimeout(resolve, 1000));";
  const countdown = [
    request(1, { model: "gpt-test" }),
    settled(2, 1, succeeded(`<codemode>\n${script}\n</codemode>`)),
    runRequested(3, 1, `async (itx) => {\n${script}\n}`),
    sent(4, "20"),
  ];
  const running = reduceAll(countdown);

  expect(running).toMatchObject({
    items: [{ kind: "assistant", text: "20" }],
    deferredAssistantMessages: [],
    queuedUserMessages: [],
  });
  expect(running.live?.steps.at(-1)).toMatchObject({
    kind: "code",
    requestOffset: 3,
    status: "running",
  });

  const completed = settleAtIdle(reduceAll([...countdown, runSettled(5, 3)]));

  expect(completed.live).toBeNull();
  expect(completed.items.map((item) => item.kind)).toEqual(["assistant", "activity"]);
  expect(completed.items[1]).toMatchObject({
    kind: "activity",
    status: "done",
    steps: [
      { kind: "llm", status: "done" },
      { kind: "code", requestOffset: 3, status: "done" },
    ],
  });
});

// The script sends the visible reply, settles, and the stream goes quiet. The reply shows at once,
// and the journal fold alone closes the activity at the settle: it does not wait for an idle
// boundary or some future event.
test("a script-sent reply shows at once and its script's settle closes the activity when nothing else runs", () => {
  const state = reduceAll([
    said(1, "ok what model are you using?"),
    request(2, { model: "xai/grok-4.5" }),
    settled(3, 2),
    runRequested(4, 2, "async (itx) => {\n  await say('grok');\n}"),
    sent(5, "I'm using **xai/grok-4.5**."),
    runSettled(6, 4),
  ]);

  expect(state.live).toBeNull();
  expect(state).toMatchObject({ deferredAssistantMessages: [] });
  expect(state.items.map((item) => item.kind)).toEqual(["user", "assistant", "activity"]);
  expect(state.items[1]).toMatchObject({
    kind: "assistant",
    text: "I'm using **xai/grok-4.5**.",
  });
  expect(state.items[2]).toMatchObject({
    kind: "activity",
    status: "done",
    steps: [
      { kind: "llm", status: "done", outcome: "completed" },
      { kind: "code", requestOffset: 4, status: "done", success: true },
    ],
  });
});

test("stream wakes are not chat rows", () => {
  const state = reduceAll([
    fact(1, "itx/created", {}),
    fact(2, "itx/woken", {}),
    fact(3, "itx/woken", {}),
  ]);

  expect(state).toMatchObject({ items: [] });
});

test("a durable rebuild recovers the interrupted partial from the settled fact", () => {
  // Windows are ephemeral: a refold from the journal has none, so the step's
  // streamed text must come from the settled result's partialText.
  const state = reduceAll([
    request(5, { model: "gpt-test" }),
    settled(6, 5, cancelled("interrupted-by-user-input", "Let me check your cal")),
  ]);
  expect(state.live?.steps[0]).toMatchObject({
    kind: "llm",
    status: "done",
    outcome: "cancelled",
    cancelReason: "interrupted-by-user-input",
    responseText: "Let me check your cal",
  });
});

test("shows stream pause and resume events in the agent feed", () => {
  const state = reduceAll([
    fact(1, "itx/paused", { reason: "Agent circuit breaker tripped." }),
    fact(2, "itx/resumed", { reason: "Operator resumed the agent." }),
  ]);

  expect(state).toMatchObject({
    items: [
      {
        kind: "stream-paused",
        id: "stream-paused-1",
        text: "Agent paused",
        reason: "Agent circuit breaker tripped.",
        timestampMs: timeOf(1),
      },
      {
        kind: "stream-resumed",
        id: "stream-resumed-2",
        text: "Agent resumed",
        reason: "Operator resumed the agent.",
        timestampMs: timeOf(2),
      },
    ],
  });
});

test("shows agent pause and resume (the agent's own bound) as the same marker rows", () => {
  const state = reduceAll([paused(1, "3 requests in a row failed"), resumed(2, "external input")]);

  expect(state).toMatchObject({
    items: [
      {
        kind: "stream-paused",
        id: "stream-paused-1",
        text: "Agent paused",
        reason: "3 requests in a row failed",
        timestampMs: timeOf(1),
      },
      {
        kind: "stream-resumed",
        id: "stream-resumed-2",
        text: "Agent resumed",
        reason: "external input",
        timestampMs: timeOf(2),
      },
    ],
  });
});

test("settles a completed LLM request at run-level idle even without an assistant message", () => {
  const state = settleAtIdle(
    reduceAll([
      request(7, { model: "gpt-test" }),
      settled(8, 7, succeeded("done"), { durationMs: 250 }),
    ]),
  );

  expect(state.live).toBeNull();
  expect(state.items.map((item) => item.kind)).toEqual(["activity"]);
  const activity = state.items[0];
  expect(activity).toMatchObject({ kind: "activity", status: "done" });
  expect(activity?.kind === "activity" ? activity.steps : []).toMatchObject([
    { kind: "llm", llmRequestOffset: 7, status: "done", outcome: "completed" },
  ]);
});

test("the reported idle boundary closes no running step: the model call and the script stay running until their own settlements land", () => {
  const events = [request(1), runRequested(2, null, "async () => mutateExternalState()")];
  const idle = settleAtIdle(reduceAll(events));

  expect(idle).toMatchObject({ items: [] });
  expect(idle.live?.steps).toMatchObject([
    { kind: "llm", status: "running" },
    { kind: "code", status: "running" },
  ]);

  // The platform settles every run: one still going at RUN_DEADLINE_MS is settled `deadline`.
  const settledBoth = settleAtIdle(
    reduceAll([
      ...events,
      settled(3, 1),
      runSettled(4, 2, {
        status: "failed",
        error:
          "itx.run: the script did not finish within 10 minutes; it may have partly run, and it is not run again",
        failureKind: "deadline",
      }),
    ]),
  );
  expect(settledBoth.live).toBeNull();
  expect(settledBoth.items).toMatchObject([
    {
      kind: "activity",
      status: "done",
      steps: [
        { kind: "llm", status: "done", outcome: "completed" },
        {
          kind: "code",
          status: "done",
          success: false,
          errorMessage: expect.stringMatching(/did not finish within 10 minutes/),
        },
      ],
    },
  ]);
});

test("a script settlement that lands after the idle report closes the step it names", () => {
  const requested = runRequested(10, null, "async () => mutate()");
  const idle = settleAtIdle(reduceAll([requested]));
  expect(idle).toMatchObject({ items: [] });
  expect(idle.live?.steps).toMatchObject([{ kind: "code", requestOffset: 10, status: "running" }]);

  const settledRun = settleAtIdle(
    reduceAll([
      requested,
      runSettled(11, 10, { status: "succeeded", result: { committed: true } }),
    ]),
  );
  expect(settledRun.items).toMatchObject([
    {
      kind: "activity",
      id: "activity-10",
      steps: [{ kind: "code", status: "done", success: true, result: { committed: true } }],
    },
  ]);
  const [activity] = settledRun.items;
  if (activity?.kind !== "activity") throw new Error("expected the settled activity");
  expect(activity.steps[0]).not.toHaveProperty("errorMessage");
});

test("an activity with one of its two scripts still running stays live at the idle report", () => {
  const state = settleAtIdle(
    reduceAll([
      runRequested(10, null, "async () => mutateA()"),
      runRequested(11, null, "async () => mutateB()"),
      runSettled(12, 10, { status: "succeeded", result: "a" }),
    ]),
  );

  expect(state).toMatchObject({ items: [] });
  expect(state.live).toMatchObject({
    id: "activity-10",
    steps: [
      { kind: "code", requestOffset: 10, status: "done", result: "a" },
      { kind: "code", requestOffset: 11, status: "running" },
    ],
  });
});

test("the reported idle boundary never closes a running model call: only its settlement does", () => {
  const state = reduceAll([request(12, { model: "gpt-test" })]);
  const projected = settleAtIdle(state);

  expect(projected).toMatchObject({ items: [] });
  expect(projected.live?.steps).toMatchObject([{ kind: "llm", status: "running" }]);
});

test("the reported idle boundary settles the activity after a later journal event", () => {
  const state = reduceAll([
    runRequested(1, null, 'async (itx) => { await say("kumquat"); return "sent"; }'),
    sent(2, "kumquat"),
    runSettled(3, 1, { status: "succeeded", result: "sent" }),
    // words said in the agent's name: the model reads them, and the feed draws them nowhere
    fact(4, "agent/context-added", { role: "assistant", content: "I sent: kumquat" }),
  ]);

  const projected = settleAtIdle(state);

  expect(projected.live).toBeNull();
  expect(projected.items).toMatchObject([
    { kind: "assistant", text: "kumquat" },
    { kind: "activity", steps: [{ kind: "code", status: "done", success: true }] },
  ]);
});

test("a script past its deadline stays running through later input, which queues, until the platform's `deadline` settlement closes it", () => {
  const at = (ms: number) => new Date(timeOf(0) + ms).toISOString();
  const requested = { ...runRequested(1, null, "async () => mutate()"), createdAt: at(0) };
  const asked = { ...said(2, "still there?"), createdAt: at(RUN_DEADLINE_MS + 1_000) };
  const pastDeadline = reduceAll([requested, asked]);
  expect(pastDeadline).toMatchObject({ items: [] });
  expect(pastDeadline.queuedUserMessages).toMatchObject([{ text: "still there?" }]);
  expect(pastDeadline.live?.steps).toMatchObject([{ kind: "code", status: "running" }]);

  const settledRun = reduceAll([
    requested,
    asked,
    {
      ...runSettled(3, 1, {
        status: "failed",
        error: "itx.run: the script did not finish within 10 minutes",
        failureKind: "deadline",
      }),
      createdAt: at(RUN_DEADLINE_MS + 2_000),
    },
  ]);
  expect(settledRun.live).toBeNull();
  expect(settledRun.items).toMatchObject([
    {
      kind: "activity",
      steps: [{ kind: "code", success: false, durationMs: RUN_DEADLINE_MS + 2_000 }],
    },
    { kind: "user", text: "still there?" },
  ]);
});

test("queues a user message that arrives mid-turn", () => {
  const state = reduceAll([request(7, { model: "gpt-test" }), said(8, "also, one more thing")]);

  // The interjected message should stay pinned after the live activity
  // instead of settling into chronological feed rows before the current turn.
  expect(state.items).toHaveLength(0);
  expect(state.queuedUserMessages).toHaveLength(1);
  expect(state.queuedUserMessages[0]).toMatchObject({
    kind: "user",
    text: "also, one more thing",
  });
  expect(state.live?.steps[0]).toMatchObject({ kind: "llm", status: "running" });
});

test("settles queued user messages before the next LLM request starts", () => {
  const state = reduceAll([
    request(7, { model: "gpt-test" }),
    said(8, "also, one more thing"),
    settled(9, 7, succeeded("on it"), { durationMs: 100 }),
    request(12, { model: "gpt-test" }),
  ]);

  expect(state.items.map((item) => item.kind)).toEqual(["activity", "user"]);
  expect(state.items[1]).toMatchObject({
    kind: "user",
    text: "also, one more thing",
  });
  expect(state.queuedUserMessages).toHaveLength(0);
  expect(state.live?.steps).toHaveLength(1);
  expect(state.live?.steps[0]).toMatchObject({ kind: "llm", llmRequestOffset: 12 });
});

test("a request that input starts while a script still runs moves the input into the transcript and joins the script's activity", () => {
  const events = [
    said(1, "do X"),
    request(2),
    settled(3, 2),
    // a script that no response of the agent wrote, which outlives the turn
    runRequested(4, null, "async () => longWork()"),
    said(5, "and then?"),
    request(6),
    settled(7, 6),
    sent(8, "still working on X"),
    runSettled(9, 4),
  ];

  // The second request answers "and then?": the composer no longer shows it
  // queued, and the request joins the activity the script keeps running.
  const answering = reduceAll(events.slice(0, 6));
  expect(answering).toMatchObject({
    queuedUserMessages: [],
    items: [
      { kind: "user", text: "do X" },
      { kind: "user", text: "and then?" },
    ],
  });
  expect(answering.live?.steps).toMatchObject([
    { kind: "llm", llmRequestOffset: 2, status: "done" },
    { kind: "code", requestOffset: 4, status: "running" },
    { kind: "llm", llmRequestOffset: 6, status: "running" },
  ]);

  // The words land at once, above the activity the script still runs: no
  // settled activity row yet, the script still running, nothing held.
  const replied = reduceAll(events.slice(0, 8));
  expect(replied).toMatchObject({
    deferredAssistantMessages: [],
    items: [
      { kind: "user", text: "do X" },
      { kind: "user", text: "and then?" },
      { kind: "assistant", text: "still working on X" },
    ],
  });
  expect(replied.live?.steps).toMatchObject([
    { kind: "llm", llmRequestOffset: 2, status: "done" },
    { kind: "code", requestOffset: 4, status: "running" },
    { kind: "llm", llmRequestOffset: 6, status: "done", outcome: "completed" },
  ]);

  // Once the script settled and the agent says it is idle, the one activity closes, whole and
  // clean: a request joined it after the script, so the script's settlement alone does not end it.
  const settledTurn = settleAtIdle(reduceAll(events));
  expect(settledTurn.live).toBeNull();
  expect(settledTurn.items).toMatchObject([
    { kind: "user", text: "do X" },
    { kind: "user", text: "and then?" },
    { kind: "assistant", text: "still working on X" },
    {
      kind: "activity",
      id: "activity-2",
      status: "done",
      steps: [
        { kind: "llm", llmRequestOffset: 2 },
        { kind: "code", requestOffset: 4, success: true },
        { kind: "llm", llmRequestOffset: 6 },
      ],
    },
  ]);
  expect(settledTurn.items.filter((item) => item.kind === "activity")).toHaveLength(1);
  expect(summarizeAgentUiActivity(settledTurn.items[3] as AgentUiActivity)).toMatchObject({
    outcome: "clean",
  });
});

test("a reply that lands at once leaves the activity open when the script returns a value: the follow-up request joins it", () => {
  const events = [
    runRequested(1, null, "async () => longWork()"),
    said(2, "and then?"),
    request(3),
    settled(4, 3),
    sent(5, "X is still running."),
    runSettled(6, 1, { status: "succeeded", result: { done: true } }),
    request(7),
    settled(8, 7),
  ];

  const returned = reduceAll(events.slice(0, 6));
  expect(returned.items).toMatchObject([
    { kind: "user", text: "and then?" },
    { kind: "assistant", text: "X is still running." },
  ]);
  expect(returned.live?.steps).toMatchObject([
    { kind: "code", requestOffset: 1, status: "done", success: true },
    { kind: "llm", llmRequestOffset: 3, status: "done" },
  ]);

  const followedUp = reduceAll(events);
  expect(followedUp.items.filter((item) => item.kind === "activity")).toHaveLength(0);
  expect(followedUp.live?.steps).toMatchObject([
    { kind: "code", requestOffset: 1 },
    { kind: "llm", llmRequestOffset: 3 },
    { kind: "llm", llmRequestOffset: 7, status: "done" },
  ]);
});

test("a reply that lands at once follows the replies held before it in log order, and leaves later input queued", () => {
  const state = reduceAll([
    request(1),
    // words while only the model call runs are held behind the running work
    sent(2, "held"),
    settled(3, 1),
    runRequested(4, 1, "async () => longWork()"),
    said(5, "one more"),
    sent(6, "X is still running."),
  ]);

  expect(state).toMatchObject({
    items: [
      { kind: "assistant", text: "held" },
      { kind: "assistant", text: "X is still running." },
    ],
    deferredAssistantMessages: [],
    // No request has taken it up yet: it stays in the composer's queue.
    queuedUserMessages: [{ text: "one more" }],
  });
  expect(state.live?.steps).toMatchObject([
    { kind: "llm", llmRequestOffset: 1, status: "done" },
    { kind: "code", requestOffset: 4, status: "running" },
  ]);
});

test("the agent's words show at once while a script runs", () => {
  const state = reduceAll([
    runRequested(1, null, "async () => longWork()"),
    request(2),
    settled(3, 2),
    sent(4, "from a script"),
  ]);

  expect(state).toMatchObject({
    items: [{ kind: "assistant", text: "from a script" }],
    deferredAssistantMessages: [],
    live: { status: "running", steps: [{ kind: "code", status: "running" }, { kind: "llm" }] },
  });
});

test("the agent's words wait while only a model call runs", () => {
  const state = reduceAll([request(1), sent(2, "from elsewhere")]);

  expect(state).toMatchObject({
    items: [],
    deferredAssistantMessages: [{ text: "from elsewhere" }],
  });
});

test("a script that sends a link and then polls shows the link at once, and its settle closes the activity", () => {
  const started = [
    runRequested(1, null, "async (itx) => pollForConnection(itx)"),
    sent(2, "[Connect Cloudflare](https://example.com/connect)"),
  ];
  const linked = reduceAll(started);

  expect(linked).toMatchObject({
    items: [{ kind: "assistant", text: "[Connect Cloudflare](https://example.com/connect)" }],
    deferredAssistantMessages: [],
    live: { status: "running", steps: [{ kind: "code", status: "running" }] },
  });

  const polling = [...started, summary(3, "Checking for your Cloudflare connection")];

  expect(deriveAgentUiLiveStatus(reduceAll(polling))).toMatchObject({
    phase: "running",
    statusText: "Checking for your Cloudflare connection",
  });

  const nudged = [...polling, sent(4, "Still waiting for the connection.")];

  expect(reduceAll(nudged)).toMatchObject({
    items: [
      { kind: "assistant" },
      { kind: "assistant", text: "Still waiting for the connection." },
    ],
    live: { status: "running", steps: [{ kind: "code", status: "running" }] },
  });

  const settledRun = settleAtIdle(reduceAll([...nudged, runSettled(5, 1)]));

  expect(settledRun.live).toBeNull();
  expect(settledRun).toMatchObject({ deferredAssistantMessages: [], queuedUserMessages: [] });
  expect(settledRun.items.map((item) => item.kind)).toEqual(["assistant", "assistant", "activity"]);
  expect(settledRun.items[2]).toMatchObject({
    kind: "activity",
    status: "done",
    steps: [{ kind: "code", status: "done", success: true }],
  });
});

test("a request that input starts while a script still runs moves the script's earlier reply into the transcript before that input", () => {
  const state = reduceAll([
    runRequested(1, null, "async () => longWork()"),
    sent(2, "still on X"),
    said(3, "and then?"),
    request(4),
    settled(5, 4),
    runSettled(6, 1),
  ]);

  expect(state).toMatchObject({
    items: [
      { kind: "assistant", text: "still on X" },
      { kind: "user", text: "and then?" },
    ],
    deferredAssistantMessages: [],
    queuedUserMessages: [],
    live: {
      steps: [
        { kind: "code", status: "done" },
        { kind: "llm", llmRequestOffset: 4, status: "done" },
      ],
    },
  });
});

test("a running script's reply shows at once, and its settle flushes the input that queued behind the script", () => {
  const state = reduceAll([
    runRequested(1, null, "async () => longWork()"),
    said(2, "and then?"),
    sent(3, "X is done"),
    runSettled(4, 1),
  ]);

  expect(state.items).toMatchObject([
    { kind: "assistant", text: "X is done" },
    { kind: "activity", steps: [{ kind: "code", status: "done", success: true }] },
    { kind: "user", text: "and then?" },
  ]);
  expect(state).toMatchObject({ deferredAssistantMessages: [], queuedUserMessages: [] });
});

test("does not append late windows from an interrupted request into the next turn", () => {
  const state = reduceAll([
    request(7, { model: "gpt-test" }),
    frame(8, 7, { textDelta: "old partial" }),
    said(9, "oh this is taking too long"),
    settled(10, 7, cancelled("interrupted-by-user-input", "old partial")),
    frame(11, 7, { textDelta: " stale chunk" }),
    request(12, { model: "gpt-test" }),
  ]);

  expect(state.items.map((item) => item.kind)).toEqual(["activity", "user"]);
  const activity = state.items[0];
  if (activity?.kind !== "activity") throw new Error("expected activity item");
  expect(activity.steps[0]).toMatchObject({
    kind: "llm",
    llmRequestOffset: 7,
    outcome: "cancelled",
    responseText: appendText("", "old partial"),
  });
  expect(state.items[1]).toMatchObject({
    kind: "user",
    text: "oh this is taking too long",
  });
  expect(state.live?.steps).toHaveLength(1);
  expect(state.live?.steps[0]).toMatchObject({
    kind: "llm",
    llmRequestOffset: 12,
    responseText: "",
  });
});

test('a developer note that an agent wrote (`actor: { type: "agent" }`, as the Cloud\'s handover writes) is a user bubble', () => {
  const state = reduceAll([
    fact(
      1,
      "agent/context-added",
      {
        role: "developer",
        content: "Notes from the Cloud's installation agent.",
        actor: { type: "agent" },
      },
      { origin: "/" },
    ),
  ]);

  expect(state.items).toMatchObject([
    { kind: "user", text: "Notes from the Cloud's installation agent." },
  ]);
});

test("a user message's attachments render without a URL: the page signs one per file", () => {
  const file = {
    contentType: "image/png",
    filename: "screenshot.png",
    path: "files/screenshot.png",
    size: 123,
  };
  const state = reduceAll([said(1, "", { files: [file] })]);

  expect(state.items).toMatchObject([{ kind: "user", text: "", files: [file] }]);
});

test("a request that another response answered first is no failure of its round", () => {
  const state = settleAtIdle(
    reduceAll([
      said(1, "hello"),
      request(5, { model: "gpt-test" }),
      request(6, { model: "gpt-test" }),
      settled(7, 6, succeeded("Hi.")),
      settled(8, 5, cancelled("superseded")),
    ]),
  );
  const activity = state.items.find((item) => item.kind === "activity");
  if (activity?.kind !== "activity") throw new Error("expected activity item");
  expect(activity.steps.map((step) => step.kind === "llm" && step.cancelReason)).toEqual([
    "superseded",
    undefined,
  ]);
  expect(summarizeAgentUiActivity(activity)).toMatchObject({ requestCount: 2, outcome: "clean" });
});

test("groups expired and unrecognized cancellations into one failed activity", () => {
  const state = settleAtIdle(
    reduceAll([
      request(7, { model: "gpt-test" }),
      settled(8, 7, cancelled("future-cancel-reason")),
      request(11, { model: "gpt-test" }),
      settled(12, 11, cancelled("expired")),
    ]),
  );

  expect(state.live).toBeNull();
  expect(state.items).toHaveLength(1);
  const activity = state.items[0];
  if (activity?.kind !== "activity") throw new Error("expected activity item");
  // A reason this UI does not recognize stays unmapped; a cancelled step
  // without a recognized reason still counts as a failure.
  expect(activity.steps[0]).toMatchObject({
    kind: "llm",
    status: "done",
    outcome: "cancelled",
    durationMs: 1_000,
    cancelReason: undefined,
  });
  expect(activity.steps[1]).toMatchObject({ outcome: "cancelled", cancelReason: "expired" });
  expect(summarizeAgentUiActivity(activity)).toMatchObject({
    outcome: "failed",
    requestCount: 2,
  });
});

test("the first settlement wins when a duplicate races in", () => {
  // A request settles once; if a second settlement still lands, the UI must keep the first fact.
  const state = reduceAll([
    request(1, { model: "gpt-test" }),
    settled(2, 1, cancelled("interrupted-by-user-input", "Hel")),
    settled(3, 1, succeeded("late zombie response", { inputTokens: 100, outputTokens: 10 }), {
      durationMs: 2_000,
    }),
  ]);

  expect(state.live?.steps[0]).toMatchObject({
    kind: "llm",
    status: "done",
    outcome: "cancelled",
    cancelReason: "interrupted-by-user-input",
    inputTokens: undefined,
  });
  if (!state.live) throw new Error("expected live activity");
  expect(summarizeAgentUiActivity(state.live)).toMatchObject({
    outcome: "interrupted",
    requestCount: 1,
  });
});

test("the run of a response's script marks its llm step interpreted; a response with no script stays plain", () => {
  // the run's key names the request whose response wrote the script: the Script tab carries the code
  const answered = reduceAll([
    request(1),
    settled(2, 1, succeeded('Hi!\n<codemode status="Working">\nreturn 1\n</codemode>')),
    runRequested(3, 1, "async (itx) => {\nreturn 1\n}"),
  ]);
  expect(answered.live?.steps[0]).toMatchObject({ kind: "llm", interpreted: true });

  // A response that wrote no script is NOT marked.
  const plain = reduceAll([request(1), settled(2, 1, succeeded("Just prose."))]);
  const plainStep = plain.live?.steps.find((step) => step.kind === "llm");
  expect(plainStep).toMatchObject({ kind: "llm", responseText: "Just prose." });
  expect(plainStep).not.toHaveProperty("interpreted");
});

test("a script's words keep the whole turn in ONE activity, rounds paired", () => {
  const reduced = reduceAll([
    request(1),
    settled(2, 1, succeeded('Hi!\n<codemode status="Working">\nreturn 1\n</codemode>')),
    // the agent's order: the script joins the request's activity, and its words go out at once
    runRequested(3, 1, "async (itx) => 1"),
    sent(4, "Hi!"),
  ]);
  // No settled activity item was flushed mid-turn: the request and its
  // script live in the SAME activity.
  expect(reduced.items.filter((item) => item.kind === "activity")).toHaveLength(0);
  expect(reduced.live?.steps.map((step) => step.kind)).toEqual(["llm", "code"]);
  // The words stand above the activity instead of splitting it.
  expect(reduced.items).toMatchObject([{ kind: "assistant", text: "Hi!" }]);
  expect(reduced).toMatchObject({ deferredAssistantMessages: [] });
});

test("phases follow the running step: waiting → thinking → writing → running", () => {
  const waiting = reduceAll([request(5)]);
  expect(deriveAgentUiLiveStatus(waiting)).toMatchObject({ phase: "waiting", statusText: null });

  const thinking = reduceAll([request(5), frame(6, 5, { thinkingDelta: "hmm" })]);
  expect(deriveAgentUiLiveStatus(thinking)).toMatchObject({ phase: "thinking" });

  const writing = reduceAll([request(5), frame(6, 5, { textDelta: "await work()" })]);
  expect(deriveAgentUiLiveStatus(writing)).toMatchObject({ phase: "writing" });

  const running = reduceAll([request(5), runRequested(6, null)]);
  expect(deriveAgentUiLiveStatus(running)).toMatchObject({ phase: "running" });
});

test("a script that settled WITH a value means another round: processing", () => {
  const ran = [request(5), settled(6, 5), runRequested(7, 5)];
  const state = reduceAll([...ran, runSettled(8, 7, { status: "succeeded", result: 42 })]);
  expect(deriveAgentUiLiveStatus(state)).toMatchObject({ phase: "processing" });
  // A value-less settle (`return;`) ends the turn — no round is owed.
  const returned = reduceAll([...ran, runSettled(8, 7)]);
  expect(deriveAgentUiLiveStatus(returned)).toMatchObject({ phase: "working" });
  // A failed settle isn't a promise of another round either.
  const failedRun = reduceAll([
    ...ran,
    runSettled(8, 7, { status: "failed", error: "boom", failureKind: "runtime" }),
  ]);
  expect(deriveAgentUiLiveStatus(failedRun)).toMatchObject({ phase: "working" });
});

test("statusText is this turn's summary only — a previous turn's text stays generic", () => {
  const turnOne = [
    request(5),
    settled(6, 5),
    runRequested(7, 5),
    summary(8, "Sweeping March refunds"),
    runSettled(9, 7, { status: "succeeded", result: 1 }),
  ];
  expect(deriveAgentUiLiveStatus(reduceAll(turnOne))).toMatchObject({
    phase: "processing",
    statusText: "Sweeping March refunds",
  });

  // A user message settles the turn; the next turn's live activity starts
  // fresh — the stream's standing summary is stale for the live row (code
  // steps still inherit it for round headers, unchanged).
  const turnTwo = reduceAll([...turnOne, said(10, "and April?"), request(50)]);
  expect(turnTwo).toMatchObject({ summaryActivity: "Sweeping March refunds" });
  expect(deriveAgentUiLiveStatus(turnTwo)).toMatchObject({ phase: "waiting", statusText: null });

  const turnTwoUpdated = reduceAll([
    ...turnOne,
    said(10, "and April?"),
    request(50),
    summary(51, "Sweeping April refunds"),
  ]);
  expect(deriveAgentUiLiveStatus(turnTwoUpdated)).toMatchObject({
    statusText: "Sweeping April refunds",
  });
});

test("agent/paused settles an idle live activity from journal facts alone", () => {
  // The processing gap's guard: the agent pauses itself after a script returned a value —
  // without this settle the "another round is owed" inference would spin forever on
  // journal-only surfaces (mobile).
  const state = reduceAll([
    request(5),
    settled(6, 5),
    runRequested(7, 5),
    runSettled(8, 7, { status: "succeeded", result: 42 }),
    paused(9, "20 requests without outside input"),
  ]);
  expect(state.live).toBeNull();
  expect(state.items.map((item) => item.kind)).toEqual(["activity", "stream-paused"]);
  expect(state.items[0]).toMatchObject({ kind: "activity", status: "done" });
});

test("agent/paused while a request is open keeps the live activity running", () => {
  // Operator/script-appendable mid-request: the open request drains and
  // settles normally, so the pause must not archive the running step.
  const state = reduceAll([request(5), paused(6, "operator hold")]);
  expect(state.items.map((item) => item.kind)).toEqual(["stream-paused"]);
  expect(state.live?.steps).toMatchObject([{ kind: "llm", status: "running" }]);
});

test("a value-settled script of a PAUSED agent settles the activity — never processing", () => {
  // The pause folded mid-request; the drained request's script then settles
  // WITH a value. No follow-up round is coming and no second pause fact
  // will arrive, so the settle itself must close the activity instead of
  // leaving a permanent "processing" claim.
  const state = reduceAll([
    request(5),
    paused(6, "operator hold"),
    settled(7, 5),
    runRequested(8, 5),
    runSettled(9, 8, { status: "succeeded", result: 42 }),
  ]);
  expect(state).toMatchObject({ paused: true });
  expect(state.live).toBeNull();
  expect(state.items.filter((item) => item.kind === "activity")).toMatchObject([
    { status: "done" },
  ]);
  // And resuming clears the flag for the next real turn.
  const resumedState = reduceAll([request(5), paused(6), resumed(7)]);
  expect(resumedState).toMatchObject({ paused: false });
});

/** `events` through the reducer: the end state, and every settled item in emission order. */
function reduceAll(events: StreamEvent[]) {
  let state = initialAgentUiState();
  const items: AgentUiItem[] = [];
  for (const event of events) {
    const step = reduceAgentUi(state, event);
    state = step.endState;
    items.push(...step.items);
  }
  return { ...state, items };
}

/** The agent reports itself idle. */
function settleAtIdle(reduced: ReturnType<typeof reduceAll>) {
  const projected = settleAgentUiAtIdleBoundary(reduced);
  return { ...projected.endState, items: [...reduced.items, ...projected.items] };
}
