import { expect, test } from "vitest";
import { agentMessagesOf, agentProgressOf, subagentActivitiesOf } from "./agent-progress.ts";
import type { AgentRow } from "#/lib/agent-summary.ts";
import { fact, frame, paused, request, runRequested, summary } from "#/test-support/agent-log.ts";

test("progress data gives current work and public summary only", () => {
  const events = [
    request(10, { model: "test" }),
    summary(12, "Checking the release"),
    frame(14, 10, { thinkingDelta: "PRIVATE_THINKING", textDelta: "PRIVATE_RESPONSE" }),
    runRequested(20, null, "PRIVATE_SCRIPT"),
  ];
  expect(agentProgressOf(events)).toEqual({
    text: "Running a script",
    working: true,
    activity: "Checking the release",
  });
  expect(JSON.stringify(agentProgressOf(events))).not.toMatch(/PRIVATE/);
});
test("progress does not carry a previous turn's summary into new work", () => {
  const asked = request(10, { model: "test" });
  expect(agentProgressOf([summary(1, "Previous work"), asked])).toEqual({
    text: "Waiting for the model",
    working: true,
    activity: null,
  });
  expect(agentProgressOf([])).toEqual({ text: "Idle", working: false, activity: null });
  expect(agentProgressOf([asked, paused(40, "Waiting")])).toEqual({
    text: "Paused",
    working: false,
    activity: null,
  });
});
test("only explicit messages with attributed senders become safe rows; sparse offsets survive", () => {
  const events = [
    fact(2, "agent/context-added", { role: "assistant", content: "PRIVATE_CONTEXT" }),
    fact(17, "agent/message-received", {
      from: "/agents/release",
      message: "Published",
      files: [],
      privateField: "PRIVATE_FIELD",
    }),
    fact(91, "agent/message-received", { message: "Unknown source" }),
    fact(104, "agent/message-received", { from: "/agents/test", message: 42 }),
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
