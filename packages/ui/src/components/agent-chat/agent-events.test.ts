// agent-events.test.ts — the core/os log through the shared reducer: the CONTEXT's runs
// (`itx/run-requested` / `run-settled`, the request's offset as identity) are the code steps, linked
// to the assistant's message by the processor's `whileProcessing` stamp, so a turn renders as one
// activity with its code step.
import { expect, test } from "vitest";
import { RUN_DEADLINE_MS } from "iterate/stream/run";
import { committedEvent } from "iterate/stream/test-support";
import {
  foldAgentLog,
  llmTrace,
  reduceAgentFeed,
  scriptTrace,
  toAgentEvent,
} from "./agent-events.ts";

test("the run the agent asked for while processing the assistant's item is that turn's code step: keyed by the request's offset, its deadline the request's time plus RUN_DEADLINE_MS", () => {
  const events = turn().filter((e) => e.type !== "events.iterate.com/itx/run-settled");
  const { state } = reduceAgentFeed(events, false);
  const requested = events.find((e) => e.offset === 8)!;
  expect(state.live?.steps).toMatchObject([
    { kind: "llm", llmRequestOffset: 4, status: "done" },
    {
      kind: "code",
      id: "code-8",
      requestOffset: 8,
      status: "running",
      code: expect.stringContaining("itx.kv.put"),
      deadlineAtMs: Date.parse(requested.createdAt) + RUN_DEADLINE_MS,
    },
  ]);
  // a run nobody's processor asked for is a step too, by its own offset
  const { state: unasked } = reduceAgentFeed(
    [at(20, "events.iterate.com/itx/run-requested", { code: "async () => 1" })],
    false,
  );
  expect(unasked.live?.steps).toMatchObject([{ kind: "code", requestOffset: 20 }]);
});

test("a failed settlement closes the step with the platform's error", () => {
  const { items } = reduceAgentFeed(
    [
      at(
        8,
        "events.iterate.com/itx/run-requested",
        { code: "async () => 1" },
        { idempotencyKey: "agent/run-requested@6", source: byAgentWhile(6) },
      ),
      at(9, "events.iterate.com/itx/run-settled", {
        requestOffset: 8,
        settlement: {
          status: "failed",
          error: "the context restarted",
          failureKind: "interrupted",
        },
      }),
    ],
    true,
  );
  expect(items).toMatchObject([
    {
      kind: "activity",
      steps: [
        {
          kind: "code",
          requestOffset: 8,
          status: "done",
          success: false,
          errorMessage: "the context restarted",
        },
      ],
    },
  ]);
});

test("through the reducer: the person's message, then one activity whose code step is the run, settled with its result; the traces find the run by its request's offset", () => {
  const events = turn();
  const { items } = reduceAgentFeed(events, true);
  const activity = items.find((item) => item.kind === "activity");
  if (activity?.kind !== "activity") throw new Error("the turn folded to no activity");
  expect(activity).toMatchObject({
    steps: [
      expect.objectContaining({ kind: "llm", llmRequestOffset: 4, status: "done" }),
      expect.objectContaining({
        kind: "code",
        requestOffset: 8,
        status: "done",
        success: true,
        result: { stored: true },
      }),
    ],
  });
  expect(llmTrace(events, 4)?.derived).toMatchObject({ scriptRequestOffset: 8 });
  expect(scriptTrace(events, 8)).toMatchObject({
    requestOffset: 8,
    code: expect.stringContaining("itx.kv.put"),
    settlement: { value: { status: "succeeded", result: { stored: true } } },
    rendered: "Your script returned: …",
  });
});

test("an intent the agent left unopened shows nothing running: its turn ends, and the next words go straight to the transcript", () => {
  // the second message moved the trigger before the first one's debounce ran out, so the first
  // intent lands as a fact the agent's reduce ignores, and nothing will ever settle it
  const { state, items } = reduceAgentFeed(
    [
      person(1, "first"),
      person(2, "second"),
      intent(3, 1),
      intent(4, 2),
      at(5, "events.iterate.com/agent/llm-request-settled", {
        requestOffset: 4,
        result: { status: "succeeded", text: "ok" },
      }),
      at(6, "events.iterate.com/agent/web-message-sent", {
        message: "Noted.",
        llmRequestOffset: 4,
      }),
      person(7, "third"),
    ],
    true,
  );
  expect(state).toMatchObject({ live: null, queuedUserMessages: [] });
  expect(items.map((item) => item.id)).toEqual([
    "user-1",
    "user-2",
    "activity-4",
    "assistant-6",
    "user-7",
  ]);
  expect(items[2]).toMatchObject({ steps: [{ llmRequestOffset: 4, status: "done" }] });
});

test("an intent that lands after a later trigger's request opened never runs", () => {
  const { state } = reduceAgentFeed(
    [
      person(1, "first"),
      person(2, "second"),
      intent(3, 2),
      intent(4, 1),
      at(5, "events.iterate.com/agent/llm-request-settled", {
        requestOffset: 3,
        result: { status: "succeeded", text: "ok" },
      }),
    ],
    false,
  );
  expect(state.live?.steps).toMatchObject([{ llmRequestOffset: 3, status: "done" }]);
});

test("a silent turn's activity ends when its last step did, not when the next words close it", () => {
  const { items } = reduceAgentFeed(
    [
      person(1, "first"),
      intent(2, 1),
      at(3, "events.iterate.com/agent/llm-request-settled", {
        requestOffset: 2,
        result: { status: "succeeded", text: "" },
      }),
      person(600, "much later"),
    ],
    true,
  );
  expect(items[1]).toMatchObject({ kind: "activity", startedAtMs: 2_000, endedAtMs: 3_000 });
});

test("the log folded piece by piece equals it folded whole, and a settled message keeps its identity when an older page arrives", () => {
  const log = [
    person(1, "first"),
    intent(2, 1),
    at(3, "events.iterate.com/agent/llm-request-settled", {
      requestOffset: 2,
      result: { status: "succeeded", text: "" },
    }),
    person(4, "second"),
    intent(5, 4),
    at(6, "events.iterate.com/agent/llm-request-settled", {
      requestOffset: 5,
      result: { status: "succeeded", text: "" },
    }),
    person(7, "third"),
  ];
  const whole = foldAgentLog(undefined, log);
  // the newest page, then what arrives, then the page below it
  const newest = foldAgentLog(undefined, log.slice(3, 6));
  const grown = foldAgentLog(newest, log.slice(3));
  expect(grown).toMatchObject({ items: foldAgentLog(undefined, log.slice(3)).items });
  const paged = foldAgentLog(grown, log);
  expect(paged).toMatchObject({ items: whole.items, state: whole.state });
  const second = (fold: typeof whole) => fold.items.find((item) => item.id === "user-4");
  expect(second(paged)).toBe(second(grown));
});

test("the newest intent with no open request in the agent's live state is not running; the log alone cannot tell", () => {
  // a pause dropped the trigger that moved past this intent, so no later intent closes it
  const events = [
    person(1, "first"),
    person(2, "second"),
    intent(3, 1),
    at(4, "events.iterate.com/agent/paused", { reason: "stop" }),
  ];
  expect(reduceAgentFeed(events, false).state.live?.steps).toMatchObject([{ status: "running" }]);
  expect(reduceAgentFeed(events, true, false).state.live).toBeNull();
});

const at = (
  offset: number,
  type: string,
  payload: Record<string, unknown>,
  extra: { idempotencyKey?: string; source?: unknown } = {},
) => toAgentEvent({ ...committedEvent(offset, type, payload), ...extra })!;

/** A person's words at `offset`, which raise the agent's trigger. */
const person = (offset: number, content: string) =>
  at(offset, "events.iterate.com/agent/context-added", {
    role: "user",
    content,
    actor: { type: "user" },
  });

/** The agent's intent to request the model for the trigger at `triggerOffset`. */
const intent = (offset: number, triggerOffset: number) =>
  at(offset, "events.iterate.com/agent/llm-request-requested", {
    model: "m",
    expiresAt: 9e12,
    triggerOffset,
  });

/** The engine's stamp on an event the agent processor appended while processing offset 6. */
const byAgentWhile = (offset: number) => ({
  processor: { slug: "agent", whileProcessing: { offset, type: "x" } },
});

/** One turn as the agent's own log lays it out: the person asks, the model answers with a codemode
 *  script, the CONTEXT runs the script, the message goes out, the result comes back as the
 *  developer item. */
const turn = () => [
  at(1, "events.iterate.com/agent/created", { path: "/agents/support" }),
  at(2, "events.iterate.com/agent/context-added", { role: "system", content: "Be terse." }),
  at(3, "events.iterate.com/agent/context-added", {
    role: "user",
    content: "store 42",
    actor: { type: "user" },
  }),
  at(4, "events.iterate.com/agent/llm-request-requested", {
    model: "m",
    expiresAt: 9e12,
    triggerOffset: 3,
  }),
  at(5, "events.iterate.com/agent/llm-request-settled", {
    requestOffset: 4,
    result: { status: "succeeded", text: "ok" },
  }),
  at(6, "events.iterate.com/agent/context-added", {
    role: "assistant",
    llmRequestOffset: 4,
    content:
      "Storing.\n<codemode status=\"Storing\">\nawait itx.kv.put('answer', '42')\n</codemode>",
  }),
  at(
    8,
    "events.iterate.com/itx/run-requested",
    { code: "async (itx) => { await itx.kv.put('answer', '42'); return { stored: true } }" },
    { idempotencyKey: "agent/run-requested@6", source: byAgentWhile(6) },
  ),
  // the visible message: the tag's prose, sent directly
  at(9, "events.iterate.com/agent/web-message-sent", { message: "Storing.", llmRequestOffset: 4 }),
  at(10, "events.iterate.com/itx/run-settled", {
    requestOffset: 8,
    settlement: { status: "succeeded", result: { stored: true } },
  }),
  at(11, "events.iterate.com/agent/context-added", {
    role: "developer",
    content: "Your script returned: …",
    actor: { type: "script", requestOffset: 8 },
  }),
];
