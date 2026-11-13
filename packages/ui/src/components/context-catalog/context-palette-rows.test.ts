// What ⌘K lists for a mind's contexts: the five-minute selection and its order, the two sections of
// a search and their caps, the folder chips, how a path reads, and the row that opens a typed path.
// The dialog that draws them (context-palette.tsx) is not covered here.
import { expect, test } from "vitest";
import {
  contextPaletteView,
  distinctCrumbs,
  markedRanges,
  pathCrumbs,
  queryWithFolder,
  rowNoteOf,
  SECTION_CAP,
} from "./context-palette-rows.ts";
import type { ContextListing } from "./context-catalog-rows.ts";

const NOW = Date.parse("2026-11-13T12:00:00.000Z");

test.for([
  {
    name: "working rows first, then the most recent; nothing older than five minutes",
    rows: [
      listing({ path: "/old", secondsAgo: 400 }),
      listing({ path: "/recent", secondsAgo: 30 }),
      listing({ path: "/working", secondsAgo: 200, awake: true }),
      listing({ path: "/newest", secondsAgo: 5 }),
    ],
    expected: {
      quiet: false,
      sections: [
        {
          heading: "Active in the last 5 minutes",
          paths: ["/working", "/newest", "/recent"],
          total: 3,
          working: 1,
        },
      ],
    },
  },
  {
    name: "a working row long quiet is still listed: it works now",
    rows: [listing({ path: "/long-working", secondsAgo: 9_000, awake: true })],
    expected: {
      quiet: false,
      sections: [{ heading: "Active in the last 5 minutes", paths: ["/long-working"], working: 1 }],
    },
  },
  {
    name: "nothing recent: the eight most recent, and the view says it is quiet",
    rows: Array.from({ length: 10 }, (_, index) =>
      listing({ path: `/q/${String(index)}`, secondsAgo: 3_600 + index }),
    ),
    expected: {
      quiet: true,
      sections: [
        {
          heading: "Most recent",
          paths: ["/q/0", "/q/1", "/q/2", "/q/3", "/q/4", "/q/5", "/q/6", "/q/7"],
          total: 8,
        },
      ],
    },
  },
  {
    name: "a mind with no contexts: quiet, and no section",
    rows: [],
    expected: { quiet: true, sections: [] },
  },
])("no query: $name", ({ rows, expected }) => {
  expect(
    shape(contextPaletteView({ rows, found: undefined, query: " ", nowMs: NOW })),
  ).toMatchObject({
    ...expected,
    folders: [],
    openPath: undefined,
  });
});

test.for([
  {
    name: "recent matches first, then every other match, the most recent first",
    query: "claude",
    expected: [
      { heading: "Active in the last 5 minutes", paths: ["/agents/claude/a"] },
      { heading: "All other contexts", paths: ["/agents/claude/b", "/agents/claude/c"] },
    ],
  },
  {
    name: "no recent match: one section of all contexts",
    query: "secrets",
    expected: [{ heading: "All contexts", paths: ["/secrets/openai"] }],
  },
  {
    name: "a word that starts with '/' matches the start of a path, not its middle",
    query: "/claude",
    expected: [],
  },
  {
    name: "a path word and a free word together",
    query: "/agents/ webhook",
    expected: [{ heading: "All contexts", paths: ["/agents/claude/c"] }],
  },
])("a query: $name", ({ query, expected }) => {
  const rows = [
    listing({ path: "/agents/claude/a", secondsAgo: 20 }),
    listing({ path: "/agents/claude/b", secondsAgo: 900 }),
    listing({
      path: "/agents/claude/c",
      secondsAgo: 2_000,
      eventTypes: { "events.iterate.com/github/webhook-received": 1 },
    }),
    listing({ path: "/secrets/openai", secondsAgo: 4_000 }),
  ];
  // an array matches whole: no section more and none less
  expect(shape(contextPaletteView({ rows, found: undefined, query, nowMs: NOW }))).toMatchObject({
    sections: expected.map((part) => ({ ...part, total: part.paths.length, working: 0 })),
  });
});

test("each section shows at most SECTION_CAP rows and counts every match", () => {
  const rows = Array.from({ length: 70 }, (_, index) =>
    listing({ path: `/agents/x${String(index)}`, secondsAgo: 1_000 + index }),
  );
  const view = contextPaletteView({ rows, found: undefined, query: "agents", nowMs: NOW });
  expect(view.sections).toMatchObject([{ heading: "All contexts", total: 70 }]);
  expect(view.sections[0]!.rows).toHaveLength(SECTION_CAP);
});

test.for([
  {
    name: "the mind's answer for this query matches as it is, beside the page's own matches",
    found: { query: "invoice", rows: [listing({ path: "/agents/far", secondsAgo: 9_999 })] },
    expected: ["/agents/near", "/agents/far"],
  },
  {
    name: "an answer for an older query is filtered by this one",
    found: {
      query: "invo",
      rows: [
        listing({ path: "/agents/far", secondsAgo: 9_999 }),
        listing({ path: "/agents/invoice-2", secondsAgo: 9_000 }),
      ],
    },
    expected: ["/agents/near", "/agents/invoice-2"],
  },
  {
    name: "a path in both is listed once, with the answer's newer row",
    found: { query: "invoice", rows: [listing({ path: "/agents/near", secondsAgo: 10 })] },
    expected: ["/agents/near"],
  },
])("a search of the mind: $name", ({ found, expected }) => {
  const rows = [
    listing({ path: "/agents/near", secondsAgo: 1_000, description: "Chases an invoice" }),
    listing({ path: "/agents/other", secondsAgo: 1_000 }),
  ];
  const view = contextPaletteView({ rows, found, query: "invoice", nowMs: NOW });
  expect(view.sections.flatMap((part) => part.rows.map((row) => row.path))).toEqual(expected);
});

test.for([
  {
    name: "a query's matches by top folder, the largest first",
    query: "x",
    expected: {
      folders: [
        { folder: "agents", count: 2, active: false },
        { folder: "secrets", count: 1, active: false },
      ],
      paths: ["/agents/x1", "/agents/x2", "/secrets/x3"],
    },
  },
  {
    name: "a chosen folder narrows the rows and its chip stays, to take it out again",
    query: "/secrets/ x",
    expected: {
      folders: [
        { folder: "agents", count: 2, active: false },
        { folder: "secrets", count: 1, active: true },
      ],
      paths: ["/secrets/x3"],
    },
  },
  {
    name: "matches in one folder only: no chips, they would not narrow",
    query: "x1",
    expected: { folders: [], paths: ["/agents/x1"] },
  },
])("the folder chips: $name", ({ query, expected }) => {
  const rows = [
    listing({ path: "/agents/x1", secondsAgo: 1_000 }),
    listing({ path: "/agents/x2", secondsAgo: 1_001 }),
    listing({ path: "/secrets/x3", secondsAgo: 1_002 }),
  ];
  const view = contextPaletteView({ rows, found: undefined, query, nowMs: NOW });
  expect({
    folders: view.folders,
    paths: view.sections.flatMap((part) => part.rows.map((row) => row.path)),
  }).toEqual(expected);
});

test.for([
  {
    name: "a chip puts its folder word first",
    query: "claude",
    folder: "agents",
    expected: "/agents/ claude ",
  },
  {
    name: "another chip replaces it",
    query: "/agents/ claude ",
    folder: "secrets",
    expected: "/secrets/ claude ",
  },
  {
    name: "no chip takes it out",
    query: "/agents/ claude ",
    folder: undefined,
    expected: "claude",
  },
  { name: "a chip alone", query: "", folder: "agents", expected: "/agents/ " },
])("a chip's query: $name", ({ query, folder, expected }) => {
  expect(queryWithFolder(query, folder)).toBe(expected);
});

test.for([
  { name: "a path no context has", query: "/agents/new-thing", expected: "/agents/new-thing" },
  { name: "its trailing slash goes", query: " /agents/new-thing/ ", expected: "/agents/new-thing" },
  { name: "a path a context has", query: "/agents/known", expected: undefined },
  { name: "words, not a path", query: "/agents/new thing", expected: undefined },
  { name: "a folder chip's word alone", query: "/secrets/", expected: undefined },
  { name: "an empty segment", query: "/agents//x", expected: undefined },
])("the row that opens a typed path: $name", ({ query, expected }) => {
  const rows = [listing({ path: "/agents/known", secondsAgo: 10 })];
  expect(contextPaletteView({ rows, found: undefined, query, nowMs: NOW })).toMatchObject({
    openPath: expected,
  });
});

test.for([
  { name: "the root", path: "/", expected: { folder: [], name: "/" } },
  { name: "a top-level context", path: "/agents", expected: { folder: [], name: "agents" } },
  {
    name: "a long folder segment keeps its start and end; the name stays whole",
    path: "/agents/claude/session-of-monday-morning/review-the-docs",
    expected: { folder: ["agents", "claude", "session-…ning"], name: "review-the-docs" },
  },
  {
    name: "a segment of 16 characters stays whole",
    path: "/integrations/google/jonas@nustom.com/inbox",
    expected: { folder: ["integrations", "google", "jonas@nustom.com"], name: "inbox" },
  },
])("a path's crumbs: $name", ({ path, expected }) => {
  expect(pathCrumbs(path)).toEqual(expected);
});

test("two paths whose short crumbs read the same both show their folder whole", () => {
  const twins = [
    "/agents/claude/session-of-monday-morning/x",
    "/agents/claude/session-of-sunday-morning/x",
  ];
  const crumbs = distinctCrumbs([...twins, "/agents/claude/session-of-tuesday-noon/y"]);
  expect(Object.fromEntries(crumbs)).toEqual({
    [twins[0]!]: {
      folder: ["agents", "claude", "session-of-monday-morning"],
      name: "x",
    },
    [twins[1]!]: {
      folder: ["agents", "claude", "session-of-sunday-morning"],
      name: "x",
    },
    "/agents/claude/session-of-tuesday-noon/y": {
      folder: ["agents", "claude", "session-…noon"],
      name: "y",
    },
  });
});

test.for([
  {
    name: "what it last did, in plain words",
    words: [],
    row: { recentTypes: ["events.iterate.com/claude-code/hook-received"] },
    expected: "hook received",
  },
  {
    name: "a one-word event keeps its namespace",
    words: [],
    row: { recentTypes: ["events.iterate.com/itx/woken"] },
    expected: "itx woken",
  },
  { name: "no recent types: the count", words: [], row: { eventCount: 39 }, expected: "39 events" },
  {
    name: "a word that matched a processor only",
    words: ["linter"],
    row: { processors: ["ai-linter"] },
    expected: "runs ai-linter",
  },
  {
    name: "a word that matched an event type only",
    words: ["webhook"],
    row: { eventTypes: { "events.iterate.com/github/webhook-received": 2 } },
    expected: "had github/webhook-received",
  },
  {
    name: "a word the path shows: what it last did",
    words: ["claude"],
    row: { recentTypes: ["events.iterate.com/claude-code/hook-received"] },
    expected: "hook received",
  },
])("a row's note: $name", ({ words, row, expected }) => {
  expect(
    rowNoteOf({ ...listing({ path: "/agents/claude/a", secondsAgo: 1 }), ...row }, words),
  ).toBe(expected);
});

test.for([
  { name: "no words", text: "Claude Code", words: [], expected: [] },
  {
    name: "every occurrence, any case",
    text: "claude/Claude",
    words: ["claude"],
    expected: [
      [0, 6],
      [7, 13],
    ],
  },
  { name: "overlapping words merge", text: "webhook", words: ["webh", "hook"], expected: [[0, 7]] },
])("the marked text: $name", ({ text, words, expected }) => {
  expect(markedRanges(text, words)).toEqual(expected);
});

/** The view with each section's rows as paths. */
function shape(view: ReturnType<typeof contextPaletteView>) {
  return {
    ...view,
    sections: view.sections.map(({ rows, ...part }) => ({
      ...part,
      paths: rows.map((row) => row.path),
    })),
  };
}

function listing({
  path,
  secondsAgo,
  awake,
  ...rest
}: Omit<Partial<ContextListing>, "awake"> & {
  path: string;
  secondsAgo: number;
  awake?: boolean;
}): ContextListing {
  const at = new Date(NOW - secondsAgo * 1000).toISOString();
  return {
    path,
    eventCount: 0,
    eventTypes: {},
    recentTypes: [],
    processors: [],
    lastActivityAt: at,
    ...(awake && { awake: { since: NOW - secondsAgo * 1000 } }),
    ...rest,
  };
}
