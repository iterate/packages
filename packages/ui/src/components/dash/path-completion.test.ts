// ⌘K's path mode: the paths one level deeper than the typed folder, by the start of each segment
// or its letters in order, and what Tab makes of the query.
import { expect, test } from "vitest";
import { completedPath, pathCompletions, typedFolderOf, typedPathOf } from "./path-completion.ts";

const rows = [
  { path: "/agents", lastActivityAt: "2026-01-01" },
  { path: "/agents/onboarding", lastActivityAt: "2026-01-02" },
  { path: "/agents/people/jonas/web/b", lastActivityAt: "2026-01-09" },
  { path: "/agents/people/misha/web/c", lastActivityAt: "2026-01-03" },
  { path: "/Agenda", lastActivityAt: "2026-01-05" },
  { path: "/secrets/slack", lastActivityAt: "2026-01-04" },
].map((row) => ({ eventCount: 1, eventTypes: {}, recentTypes: [], processors: [], ...row }));

test("the paths one level deeper, each whole, with how many are below it", () => {
  // the folders that start with "ag" first, the newest first; "/agenda" keeps its case
  expect(pathCompletions(rows, "/ag")).toMatchObject({
    entries: [
      { path: "/agents", context: true, below: 3, activeAt: "2026-01-09" },
      { path: "/Agenda", context: true, below: 0, activeAt: "2026-01-05" },
    ],
  });
  // right after a "/", every child; a folder that holds contexts and is none itself
  expect(pathCompletions(rows, "/agents/").entries.map((entry) => entry.path)).toEqual([
    "/agents/people",
    "/agents/onboarding",
  ]);
  expect(pathCompletions(rows, "/agents/").entries[0]).toMatchObject({ context: false, below: 2 });
});

test("a segment matches by its start first, then by its letters in order, at every level", () => {
  expect(pathCompletions(rows, "/ag/pe/js").entries.map((entry) => entry.path)).toEqual([
    "/agents/people/jonas",
  ]);
  // "sl" starts "slack"; "sk" is in it in order; both find it, and nothing else
  expect(pathCompletions(rows, "/secrets/sk").entries.map((entry) => entry.path)).toEqual([
    "/secrets/slack",
  ]);
  expect(pathCompletions(rows, "/nothing")).toMatchObject({ total: 0 });
});

test("Tab takes the highlighted path, and a slash when contexts are below it", () => {
  const [agents, agenda] = pathCompletions(rows, "/ag").entries;
  expect(completedPath(agents!)).toBe("/agents/");
  expect(completedPath(agenda!)).toBe("/Agenda");
  // the mind is asked for the contexts under the folder typed so far
  expect(["/", "/ag", "/agents/", "/agents/peo"].map(typedFolderOf)).toEqual([
    "/",
    "/",
    "/agents",
    "/agents",
  ]);
  // with no match, the typed path opens as it is
  expect(typedPathOf("/agents/new/")).toBe("/agents/new");
  expect(typedPathOf("/a b")).toBeUndefined();
});
