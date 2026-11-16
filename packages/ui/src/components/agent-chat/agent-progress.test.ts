import { expect, test } from "vitest";
import { agentMessagesOf, agentProgressOf, subagentActivitiesOf } from "./agent-progress.ts";
import type { AgentRow } from "#/lib/agent-summary.ts";

test("progress data gives current work and public summary only", () => {
  const events = [
    request,
    row(12, "events.iterate.com/agent/summary-updated", { activity: "Checking the release" }),
    row(14, "events.iterate.com/agent/llm-response-frame", {
      llmRequestOffset: 10,
      sequence: 0,
      thinkingDelta: "PRIVATE_THINKING",
      responseDelta: "PRIVATE_RESPONSE",
    }),
    row(20, "events.iterate.com/itx/run-requested", { code: "PRIVATE_SCRIPT" }),
  ];
  expect(agentProgressOf(events)).toEqual({
    text: "Running a script",
    working: true,
    activity: "Checking the release",
  });
  expect(JSON.stringify(agentProgressOf(events))).not.toMatch(/PRIVATE/);
});
test("progress does not carry a previous turn's summary into new work", () => {
  const old = row(1, "events.iterate.com/agent/summary-updated", { activity: "Previous work" });
  expect(agentProgressOf([old, request])).toEqual({
    text: "Waiting for the model",
    working: true,
    activity: null,
  });
  expect(agentProgressOf([])).toEqual({ text: "Idle", working: false, activity: null });
  expect(
    agentProgressOf([request, row(40, "events.iterate.com/agent/paused", { reason: "Waiting" })]),
  ).toEqual({ text: "Paused", working: false, activity: null });
});
test("only explicit messages with attributed senders become safe rows; sparse offsets survive", () => {
  const events = [
    row(2, "events.iterate.com/agent/context-added", {
      role: "assistant",
      content: "PRIVATE_CONTEXT",
    }),
    row(17, "events.iterate.com/agent/message-received", {
      from: "/agents/release",
      message: "Published",
      files: [],
      privateField: "PRIVATE_FIELD",
    }),
    row(91, "events.iterate.com/agent/message-received", { message: "Unknown source" }),
    row(104, "events.iterate.com/agent/message-received", { from: "/agents/test", message: 42 }),
  ];
  expect(agentMessagesOf(events)).toEqual([
    {
      key: "agent-message:17",
      offset: 17,
      createdAt: events[1]!.createdAt,
      from: "/agents/release",
      text: "Published",
    },
  ]);
  expect(JSON.stringify(agentMessagesOf(events))).not.toMatch(/PRIVATE|Unknown/);
});
test("activity selects active rows and exposes only display fields", () => {
  const base: AgentRow = {
    path: "/agents/room/a",
    createdAt: "2026-01-01",
    parent: "/agents/room",
    kind: "iterate",
    host: null,
    status: "working",
    activity: "Checking release",
    description: "PRIVATE_DESCRIPTION",
    title: "Release",
    lastActivityAt: null,
  };
  expect(
    subagentActivitiesOf([
      base,
      { ...base, path: "/agents/room/b", status: "idle" },
      { ...base, path: "/agents/room/c", status: "waiting" },
    ]),
  ).toEqual([
    { path: base.path, title: "Release", activity: "Checking release", status: "working" },
    { path: "/agents/room/c", title: "Release", activity: "Checking release", status: "waiting" },
  ]);
  expect(JSON.stringify(subagentActivitiesOf([base]))).not.toContain("PRIVATE");
});

const row = (offset: number, type: string, payload: unknown) => ({
  offset,
  type,
  payload,
  createdAt: new Date(1000 + offset).toISOString(),
});
const request = row(10, "events.iterate.com/agent/llm-request-requested", { model: "test" });
