import { expect, test } from "vitest";
import { agentRowsOf, orderAgents, topLevelAgents, type AgentRow } from "./agent-summary.ts";

test("a row has what its agent said about itself, and nothing for what it hasn't", () => {
  expect(
    agentRowsOf({
      agents: {
        "/agents/claude/s1": {
          createdAt: "2026-01-01T00:00:00.000Z",
          parent: undefined,
          kind: "claude",
          host: "laptop",
          status: "working",
          activity: "Running the tests",
          description: "Fixes the flaky build.",
          title: "Fix the build",
          titleAtOffset: 4,
          lastActivityAt: "2026-01-02T00:00:00.000Z",
          fieldAtOffset: { kind: 1 },
        },
        "/agents/claude/s1/sub": {
          createdAt: "2026-01-01T00:00:00.000Z",
          parent: "/agents/claude/s1",
          status: "napping",
        },
      },
      deleted: { "/agents/dead": { deletedAt: "2026-01-01T00:00:00.000Z" } },
    }),
  ).toEqual([
    {
      path: "/agents/claude/s1",
      createdAt: "2026-01-01T00:00:00.000Z",
      parent: null,
      kind: "claude",
      host: "laptop",
      status: "working",
      activity: "Running the tests",
      description: "Fixes the flaky build.",
      title: "Fix the build",
      lastActivityAt: "2026-01-02T00:00:00.000Z",
    },
    {
      ...row("/agents/claude/s1/sub", "2026-01-01T00:00:00.000Z", null),
      parent: "/agents/claude/s1",
    },
  ]);
});

test("the sidebar lists the agents at the top; a row that only holds others is a folder", () => {
  const listed = topLevelAgents([
    // `/agents/web` holds every web agent and never says what it is
    row("/agents/web", "2026-01-01", null),
    { ...row("/agents/web/a", "2026-01-01", null), parent: "/agents/web", kind: "iterate" },
    { ...row("/agents/web/a/sub", "2026-01-01", null), parent: "/agents/web/a", kind: "iterate" },
    { ...row("/agents/claude/s1", "2026-01-01", null), kind: "claude" },
    { ...row("/agents/claude/s1/sub", "2026-01-01", null), parent: "/agents/claude/s1" },
    // an agent with no kind, holding nothing: listed
    row("/agents/support", "2026-01-01", null),
    // a context that never said what it is, holding one that hasn't either
    row("/agents/claude/s2", "2026-01-01", null),
    { ...row("/agents/claude/s2/sub", "2026-01-01", null), parent: "/agents/claude/s2" },
  ]);
  expect(listed.map((item) => item.path)).toEqual([
    "/agents/web/a",
    "/agents/claude/s1",
    "/agents/support",
    "/agents/claude/s2/sub",
  ]);
});

test("a value that is not a catalog has no rows", () => {
  expect(agentRowsOf(undefined)).toEqual([]);
  expect(agentRowsOf({ agents: { "/a": { createdAt: 1 } } })).toEqual([]);
});

const rows: AgentRow[] = [
  row("/agents/old", "2026-01-01", null),
  row("/agents/never-moved", "2026-01-04", null),
  row("/agents/moved", "2026-01-02", "2026-01-05"),
  row("/agents/tied-b", "2026-01-02", "2026-01-03"),
  row("/agents/tied-a", "2026-01-02", "2026-01-03"),
];

test("most recently active first — the last move, else the birth — the path breaking a tie", () => {
  expect(orderAgents(rows, new Set()).recent.map((item) => item.path)).toEqual([
    "/agents/moved",
    "/agents/never-moved",
    "/agents/tied-a",
    "/agents/tied-b",
    "/agents/old",
  ]);
});

test("pinned agents are their own list, in the same order; the rest keep theirs", () => {
  const ordered = orderAgents(rows, new Set(["/agents/old", "/agents/never-moved"]));
  expect(ordered).toMatchObject({
    pinned: [{ path: "/agents/never-moved" }, { path: "/agents/old" }],
    recent: [{ path: "/agents/moved" }, { path: "/agents/tied-a" }, { path: "/agents/tied-b" }],
  });
});

function row(path: string, createdAt: string, lastActivityAt: string | null): AgentRow {
  return {
    path,
    createdAt,
    parent: null,
    kind: null,
    host: null,
    status: null,
    activity: null,
    description: null,
    title: null,
    lastActivityAt,
  };
}
