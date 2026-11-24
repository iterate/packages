// agent-events.test.ts: the agent's log through the shared reducer. The context's runs
// (`itx/run-requested` / `run-settled`, the request's offset as identity) are the code steps, linked
// to the request whose response wrote them by the run's idempotency key, so a turn renders as one
// activity with its code step. The fold reads the current version of the path alone.
import { expect, test } from "vitest";
import { RUN_DEADLINE_MS } from "iterate/stream/run";
import { foldAgentLog, reduceAgentFeed, scriptTrace } from "./agent-events.ts";
import { llmRequestTrace } from "./llm-request-trace.ts";
import {
  created,
  fact,
  PATH,
  paused,
  quiet,
  request,
  runRequested,
  runSettled,
  said,
  scriptResult,
  sent,
  settled,
  succeeded,
  timeOf,
  versionEnded,
} from "#/test-support/agent-log.ts";

test("the run of the response's script is that turn's code step: keyed by the run's offset, its deadline the run's time plus RUN_DEADLINE_MS", () => {
  const events = turn().filter((event) => event.offset < 10);
  const { state } = reduceAgentFeed(events, false);
  expect(state.live?.steps).toMatchObject([
    { kind: "llm", llmRequestOffset: 4, status: "done", interpreted: true },
    {
      kind: "code",
      id: "code-8",
      requestOffset: 8,
      status: "running",
      code: expect.stringContaining("itx.kv.put"),
      deadlineAtMs: timeOf(8) + RUN_DEADLINE_MS,
    },
  ]);
  // a run that no response of the agent wrote is a step too, by its own offset
  const { state: unasked } = reduceAgentFeed([runRequested(20, null, "async () => 1")], false);
  expect(unasked.live?.steps).toMatchObject([{ kind: "code", requestOffset: 20 }]);
});

test("a failed settlement closes the step with the platform's error", () => {
  const { items } = reduceAgentFeed(
    [
      runRequested(8, 6, "async () => 1"),
      runSettled(9, 8, {
        status: "failed",
        error: "the context restarted",
        failureKind: "interrupted",
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

test("through the reducer: the person's message, then one activity whose code step is the run, settled with its result; the traces find the run by the request whose response wrote it, and what the model saw of its result", () => {
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
      expect.objectContaining({ kind: "llm", llmRequestOffset: 11, status: "done" }),
    ],
  });
  expect(llmRequestTrace(events, 4)).toMatchObject({ scriptRequestOffsets: [8] });
  expect(scriptTrace(events, 8)).toMatchObject({
    requestOffset: 8,
    code: expect.stringContaining("itx.kv.put"),
    settlement: { value: { status: "succeeded", result: { stored: true } } },
    seen: 'Result of script 1:\n{"stored":true}',
  });
});

test("a script's result that names another script of the same response, or another response, is not what this run's model saw", () => {
  const events = [
    ...turn().filter((event) => event.offset < 11),
    request(11, {
      itemsAdded: [
        scriptResult(4, "the second script's", 1),
        scriptResult(5, "another response's"),
      ],
    }),
  ];
  expect(scriptTrace(events, 8)).toMatchObject({ requestOffset: 8, seen: undefined });
});

test("a silent turn's activity ends when its last step did, not when the next words close it", () => {
  const { items } = reduceAgentFeed(
    [said(1, "first"), request(2), settled(3, 2, succeeded("")), said(600, "much later")],
    true,
  );
  expect(items[1]).toMatchObject({
    kind: "activity",
    startedAtMs: timeOf(2),
    endedAtMs: timeOf(3),
  });
});

test("the log folded piece by piece equals it folded whole, and a settled message keeps its identity when an older page arrives", () => {
  const log = [
    said(1, "first"),
    request(2),
    settled(3, 2, succeeded("")),
    said(4, "second"),
    request(5),
    settled(6, 5, succeeded("")),
    said(7, "third"),
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

test("inputs that start no turn are one row under the first one's id; words that start a turn end the run", () => {
  const { items } = reduceAgentFeed(
    [input(1), input(2), input(3), said(4, "what came in?"), input(5)],
    true,
  );
  expect(items).toMatchObject([
    {
      kind: "background",
      id: "background-1",
      messages: [{ offset: 1 }, { offset: 2 }, { offset: 3 }],
    },
    { kind: "user", id: "user-4", text: "what came in?" },
    { kind: "background", id: "background-5", messages: [{ offset: 5, text: "input 5" }] },
  ]);
});

test("an input that starts no turn waits behind a request and queues nothing: it comes out where the log has it", () => {
  const log = [said(1, "asked"), request(2), input(3), input(4)];
  const working = reduceAgentFeed(log, false);
  expect(working.state).toMatchObject({
    queuedUserMessages: [],
    live: { steps: [{ kind: "llm", status: "running" }] },
  });
  expect(working.items).toMatchObject([{ id: "user-1" }]);

  const answered = reduceAgentFeed([...log, settled(5, 2, succeeded("ok")), sent(6, "ok")], false);
  expect(answered.state.live).toBeNull();
  expect(answered.items.map((item) => item.id)).toEqual([
    "user-1",
    "activity-2",
    "background-3",
    "assistant-6",
  ]);
});

test("an input between a turn's two requests leaves the turn whole, and shows once the agent is idle", () => {
  const log = [
    said(1, "asked"),
    request(2),
    settled(3, 2, succeeded("ok")),
    input(4),
    request(5),
    settled(6, 5, succeeded("ok")),
  ];
  const { items } = reduceAgentFeed(log, true);
  expect(items).toMatchObject([
    { id: "user-1" },
    { kind: "activity", id: "activity-2", steps: [{ kind: "llm" }, { kind: "llm" }] },
    { id: "background-4" },
  ]);
});

test("a run keeps its row's id as it grows, and every other row its identity", () => {
  const log: unknown[] = [said(1, "asked"), input(2)];
  const first = foldAgentLog(undefined, log);
  const grown = foldAgentLog(first, [...log, input(3)]);
  expect(grown.items[0]).toBe(first.items[0]);
  expect(grown.items[1]).toMatchObject({
    id: "background-2",
    messages: [{ offset: 2 }, { offset: 3 }],
  });
});

test("a fold from a later offset gives the same rows, but for the one run its first page cut", () => {
  const whole = [
    input(1),
    input(2),
    input(3),
    said(4, "first"),
    input(5),
    said(6, "second"),
    input(7),
    input(8),
  ];
  const rows = (log: typeof whole) => reduceAgentFeed(log, true).items;
  expect(rows(whole.slice(3))).toEqual(rows(whole).slice(1));
  const cut = rows(whole.slice(1));
  expect(cut[0]).toMatchObject({ id: "background-2", messages: [{ offset: 2 }, { offset: 3 }] });
  expect(cut.slice(1)).toEqual(rows(whole).slice(1));

  // the older page refolds it: the run is whole under its first id, and the rest keep their identity
  const newest = foldAgentLog(undefined, whole.slice(1));
  const refolded = foldAgentLog(newest, whole);
  expect(refolded.items[0]).toMatchObject({ id: "background-1", messages: [{}, {}, {}] });
  expect(refolded.items.slice(1)).toEqual(newest.items.slice(1));
  expect(refolded.items[1]).toBe(newest.items[1]);
  expect(refolded.items[2]).toBe(newest.items[2]);
});

test("a refold keeps a run that is the same, and takes one that grew", () => {
  const log = [said(2, "asked"), input(3)];
  const newest = foldAgentLog(undefined, log);
  const older = foldAgentLog(newest, [said(1, "earlier"), ...log]);
  expect(older.items[2]).toBe(newest.items[1]);
  const both = foldAgentLog(newest, [said(1, "earlier"), ...log, input(4)]);
  expect(both.items[2]).toMatchObject({ id: "background-3", messages: [{}, {}] });
});

test("a request that the agent's live state does not hold open is not running; the log alone cannot tell", () => {
  const events = [said(1, "first"), request(2), paused(3, "stop")];
  expect(reduceAgentFeed(events, false).state.live?.steps).toMatchObject([{ status: "running" }]);
  expect(reduceAgentFeed(events, true, false).state.live).toBeNull();
});

// ── the border of a version ──

test("a log with an earlier version folds the current version alone: no bubble, no activity, no queued words and no running script of the earlier one", () => {
  const current = [created(9, 2), said(10, "the new question"), request(11)];
  const fold = foldAgentLog(undefined, [...earlierVersion(), versionEnded(8, 1), ...current]);
  expect(fold).toMatchObject({ versionEndedAt: 8 });
  expect(fold.events.map((event) => event.offset)).toEqual([9, 10, 11]);
  expect(fold.items).toMatchObject([{ kind: "user", id: "user-10", text: "the new question" }]);
  expect(fold.items).toHaveLength(1);
  expect(fold.state).toMatchObject({ queuedUserMessages: [], deferredAssistantMessages: [] });
  expect(fold.state.live?.steps).toMatchObject([
    { kind: "llm", llmRequestOffset: 11, status: "running" },
  ]);
  expect(fold.state.live?.steps).toHaveLength(1);
  // the same version folded on its own: the border changes nothing in the current version
  const alone = foldAgentLog(undefined, current);
  expect(fold).toMatchObject({ items: alone.items, state: alone.state });
});

test("the border that arrives on a live log starts the fold over: the earlier version's rows and work go", () => {
  const held = foldAgentLog(undefined, earlierVersion());
  expect(held.items.length).toBeGreaterThan(0);
  expect(held.state.live).not.toBeNull();
  const bordered = [...earlierVersion(), versionEnded(8, 1), created(9, 2)];
  const crossed = foldAgentLog(held, bordered);
  expect(crossed).toMatchObject({ versionEndedAt: 8, items: [], events: [{ offset: 9 }] });
  expect(crossed.state).toMatchObject({ live: null, queuedUserMessages: [] });

  // the new version's facts go on from there, and the border stays held
  const grown = foldAgentLog(crossed, [...bordered, said(10, "the new question")]);
  expect(grown).toMatchObject({
    versionEndedAt: 8,
    items: [{ kind: "user", id: "user-10" }],
    events: [{ offset: 9 }, { offset: 10 }],
  });
  expect(grown.items).toHaveLength(1);
});

test("an older page that arrives later and holds the border changes nothing in the current version", () => {
  const current = [
    created(9, 2),
    said(10, "the new question"),
    request(11),
    settled(12, 11, succeeded("ok")),
    sent(13, "the new answer"),
  ];
  const newest = foldAgentLog(undefined, current.slice(1));
  const paged = foldAgentLog(newest, [...earlierVersion(), versionEnded(8, 1), ...current]);
  expect(paged).toMatchObject({ versionEndedAt: 8, items: newest.items });
  expect(paged.items.map((item) => item.id)).toEqual(["user-10", "activity-11", "assistant-13"]);
  // a settled message keeps its identity across the page
  expect(paged.items[0]).toBe(newest.items[0]);
  expect(paged).toMatchObject({ state: foldAgentLog(undefined, current).state });
});

test("the newest border wins: two earlier versions leave the third alone", () => {
  const log = [
    said(1, "first version"),
    versionEnded(2, 1),
    created(3, 2),
    said(4, "second version"),
    versionEnded(5, 2),
    created(6, 3),
    said(7, "third version"),
  ];
  const fold = foldAgentLog(undefined, log);
  expect(fold).toMatchObject({ versionEndedAt: 5, items: [{ text: "third version" }] });
  expect(fold.items).toHaveLength(1);
});

test("a border under its earlier name, `itx/version-ended`, is a border too", () => {
  const earlierName = fact(
    2,
    "itx/version-ended",
    { version: 1, held: {} },
    { origin: PATH, platform: true },
  );
  const fold = foldAgentLog(undefined, [
    said(1, "first version"),
    earlierName,
    created(3, 2),
    said(4, "second version"),
  ]);
  expect(fold).toMatchObject({ versionEndedAt: 2, items: [{ text: "second version" }] });
  expect(fold.items).toHaveLength(1);
});

test("with no border the fold reads the whole log, and holds no border", () => {
  const fold = foldAgentLog(undefined, earlierVersion());
  expect(fold.versionEndedAt).toBeNull();
  expect(fold.events.map((event) => event.offset)).toEqual([1, 2, 3, 4, 5, 6]);
  expect(fold.items.map((item) => item.id)).toEqual(["user-1", "assistant-5"]);
  expect(fold.state).toMatchObject({ queuedUserMessages: [{ text: "queued behind the script" }] });
  expect(fold.state.live?.steps).toMatchObject([
    { kind: "llm", status: "done" },
    { kind: "code", status: "running" },
  ]);
});

/** A conversation of the earlier version, still working: a script runs, and words queue behind it. */
const earlierVersion = () => [
  said(1, "the earlier question"),
  request(2),
  settled(3, 2, succeeded("<codemode>await work()</codemode>")),
  runRequested(4, 2),
  sent(5, "the earlier answer"),
  said(6, "queued behind the script"),
];

/** One turn as the agent's own log lays it out: the person asks, the model answers with a script,
 *  the context runs the script, whose words go out, and the next request gives the model the
 *  script's result. */
const turn = () => [
  fact(2, "agent/context-added", { role: "system", content: "Be terse." }),
  said(3, "store 42"),
  request(4),
  settled(
    5,
    4,
    succeeded(
      "Storing.\n<codemode status=\"Storing\">\nawait itx.kv.put('answer', '42')\n</codemode>",
    ),
  ),
  runRequested(
    8,
    4,
    "async (itx) => { await itx.kv.put('answer', '42'); return { stored: true } }",
  ),
  // the visible message: the script sends it
  sent(9, "Storing."),
  runSettled(10, 8, { status: "succeeded", result: { stored: true } }),
  request(11, { itemsAdded: [scriptResult(4, '{"stored":true}')] }),
  settled(12, 11, succeeded("Stored.")),
];

/** An input at `offset` that starts no turn. */
function input(offset: number) {
  return quiet(offset, `input ${String(offset)}`);
}
