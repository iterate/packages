import { expect, test } from "vitest";
import {
  agentRowsOf,
  mineFirst,
  newAgentPath,
  orderAgents,
  personAt,
  personOf,
  topLevelAgents,
  type AgentRow,
} from "./agent-summary.ts";

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

test.for([
  { email: "jonas@example.com", person: "jonas" },
  { email: "Misha.K+work@Example.com", person: "misha-k-work" },
  // every run of other characters is one "-", and none stays at either end
  { email: "__a..b__@example.com", person: "a-b" },
  { email: `${"x".repeat(50)}@example.com`, person: "x".repeat(40) },
  // the cut at 40 leaves no "-" at the end
  { email: `${"y".repeat(39)}.b@example.com`, person: "y".repeat(39) },
  // no address, or one that leaves no name: no folder
  { email: undefined, person: undefined },
  { email: "", person: undefined },
  { email: "+++@example.com", person: undefined },
])("the folder of $email is $person", ({ email, person }) => {
  expect(personOf(email)).toBe(person);
});

test("a new agent is born in its person's folder, under a level of its own, and with no person where it was before", () => {
  const moment = new Date("2026-11-12T14:20:30.123Z");
  expect({
    web: newAgentPath("web", moment, "jonas"),
    claude: newAgentPath("claude", moment, "misha-k"),
    // someone with no address, and a kind whose choice does not say `byPerson` (the page then
    // passes no person)
    nobody: newAgentPath("web", moment, undefined),
    acp: newAgentPath("acp", moment, undefined),
  }).toEqual({
    web: "/agents/people/jonas/web/2026-11-12t14-20-30-123z",
    claude: "/agents/people/misha-k/claude/2026-11-12t14-20-30-123z",
    nobody: "/agents/web/2026-11-12t14-20-30-123z",
    acp: "/agents/acp/2026-11-12t14-20-30-123z",
  });
  // whose an agent is, from its path alone; a folder itself, and an agent named as the level, are no one's
  expect(
    [
      "/agents/people/jonas/web/2026-11-12t14-20-30-123z",
      "/agents/people/misha-k/claude/x/sub",
      "/agents/people/jonas",
      "/agents/people",
      "/agents/web/2026-11-12t14-20-30-123z",
      "/agents/jonas/web/x",
      "/people/jonas/web/x",
    ].map(personAt),
  ).toEqual(["jonas", "misha-k", undefined, undefined, undefined, undefined, undefined]);
});

test("a person's folders are never listed as agents, with an agent in them or with none", () => {
  const folder = (path: string, parent: string | null) => ({
    ...row(path, "2026-11-01T00:00:00.000Z", null),
    parent,
  });
  const folders = [
    folder("/agents/people", null),
    folder("/agents/people/jo", "/agents/people"),
    folder("/agents/people/jo/web", "/agents/people/jo"),
  ];
  // before the new agent has said that it is there, and after the last one there was deleted:
  // the folders hold nothing, and none of them is an agent named "web"
  expect(topLevelAgents(folders)).toEqual([]);
  const agent = {
    ...row("/agents/people/jo/web/one", "2026-11-02T00:00:00.000Z", null),
    parent: "/agents/people/jo/web",
    kind: "iterate",
  };
  expect(topLevelAgents([...folders, agent]).map((item) => item.path)).toEqual([
    "/agents/people/jo/web/one",
  ]);
  // a row that says what it is IS an agent, wherever it is: one at the level's own place too
  const named = { ...folder("/agents/people", null), title: "People" };
  expect(topLevelAgents([named]).map((item) => item.path)).toEqual(["/agents/people"]);
  // and an empty folder of the old shape is as it was: this rule is the people's folders' alone
  expect(topLevelAgents([folder("/agents/web", null)]).map((item) => item.path)).toEqual([
    "/agents/web",
  ]);
});

test("a person's own agents come first, each part in the order it had; with no person the list is as it was", () => {
  const paths = [
    "/agents/people/misha/web/newest",
    "/agents/onboarding",
    "/agents/people/jonas/web/newer",
    "/agents/web/old-one",
    "/agents/people/jonas/claude/older",
  ].map((path) => ({ path }));
  expect(mineFirst(paths, "jonas").map((item) => item.path)).toEqual([
    "/agents/people/jonas/web/newer",
    "/agents/people/jonas/claude/older",
    "/agents/people/misha/web/newest",
    "/agents/onboarding",
    "/agents/web/old-one",
  ]);
  expect(mineFirst(paths, undefined)).toEqual(paths);
  // the sidebar's two lists, each with mine first and then by what moved last
  const mine = row("/agents/people/jonas/web/a", "2026-11-01T00:00:00.000Z", null);
  const theirs = row("/agents/people/misha/web/b", "2026-11-02T00:00:00.000Z", null);
  const shared = row("/agents/onboarding", "2026-11-03T00:00:00.000Z", null);
  expect(
    orderAgents([theirs, shared, mine], new Set(["/agents/onboarding"]), "jonas"),
  ).toMatchObject({
    pinned: [{ path: "/agents/onboarding" }],
    recent: [{ path: "/agents/people/jonas/web/a" }, { path: "/agents/people/misha/web/b" }],
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
