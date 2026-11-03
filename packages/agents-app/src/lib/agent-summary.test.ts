import { expect, test } from "vitest";
import { agentRowsOf, orderAgents, type AgentRow } from "./agent-summary.ts";

test("an agent with nothing copied to its row yet has no title and no activity", () => {
  expect(
    agentRowsOf({
      agents: {
        "/agents/told": {
          createdAt: "2026-01-01T00:00:00.000Z",
          title: "Fix the build",
          lastActivityAt: "2026-01-02T00:00:00.000Z",
        },
        "/agents/old": { createdAt: "2026-01-01T00:00:00.000Z" },
      },
      deleted: { "/agents/dead": { deletedAt: "2026-01-01T00:00:00.000Z" } },
    }),
  ).toEqual([
    {
      path: "/agents/told",
      createdAt: "2026-01-01T00:00:00.000Z",
      title: "Fix the build",
      lastActivityAt: "2026-01-02T00:00:00.000Z",
    },
    {
      path: "/agents/old",
      createdAt: "2026-01-01T00:00:00.000Z",
      title: null,
      lastActivityAt: null,
    },
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
  return { path, createdAt, title: null, lastActivityAt };
}
