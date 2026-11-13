// The plain functions over the catalog's rows: the parse, the filter, a row's words and its last
// events. The components that draw them are not covered here.
import { expect, test } from "vitest";
import {
  contextListingsOf,
  contextRowDetail,
  eventRunsOf,
  filterContextListings,
  formatBytes,
  timeAgo,
  type ContextListing,
} from "./context-catalog-rows.ts";

test("an answer's rows are parsed one by one, and a row that is no listing is left out", () => {
  expect(
    contextListingsOf([listing({ path: "/a" }), { path: 7 }, "x", listing({ path: "/b" })]),
  ).toMatchObject([{ path: "/a" }, { path: "/b" }]);
  expect(contextListingsOf("not rows")).toEqual([]);
});

test.for([
  { name: "no words keep every row", query: "  ", expected: ["/agents/a", "/repos/config", "/x"] },
  { name: "a word of the path", query: "repos", expected: ["/repos/config"] },
  { name: "a word of the description, in any case", query: "INVOICE", expected: ["/agents/a"] },
  { name: "an event type", query: "commit-pushed", expected: ["/repos/config"] },
  { name: "a processor's name", query: "agent-loop", expected: ["/agents/a"] },
  { name: "a value of the metadata", query: "billing", expected: ["/x"] },
  { name: "every word must occur", query: "agents commit", expected: [] },
])("the filter: $name", ({ query, expected }) => {
  const rows = [
    listing({
      path: "/agents/a",
      description: "Chases an invoice",
      processors: ["agent-loop"],
      eventTypes: { "events.iterate.com/agent/turn-started": 3 },
    }),
    listing({ path: "/repos/config", eventTypes: { "events.iterate.com/repo/commit-pushed": 1 } }),
    listing({ path: "/x", metadata: { team: "billing" } }),
  ];
  expect(filterContextListings(rows, query).map((row) => row.path)).toEqual(expected);
});

test.for([
  { name: "this moment", secondsAgo: 2, expected: "now" },
  { name: "seconds", secondsAgo: 40, expected: "40 s" },
  { name: "minutes", secondsAgo: 200, expected: "3 min" },
  { name: "hours", secondsAgo: 5 * 3_600 + 10, expected: "5 h" },
  { name: "days", secondsAgo: 12 * 86_400, expected: "12 d" },
])("how long ago: $name", ({ secondsAgo, expected }) => {
  const now = Date.parse("2026-11-13T12:00:00.000Z");
  expect(timeAgo(new Date(now - secondsAgo * 1000).toISOString(), now)).toBe(expected);
});

test.for([
  { bytes: 812, expected: "812 B" },
  { bytes: 4_200, expected: "4.2 kB" },
  { bytes: 1_300_000, expected: "1.3 MB" },
])("a size of $bytes bytes reads $expected", ({ bytes, expected }) => {
  expect(formatBytes(bytes)).toBe(expected);
});

test("a row says its description, or else its last event types, the newest first", () => {
  const types = ["events.iterate.com/agent/turn-started", "demo/ping"];
  expect(contextRowDetail(listing({ path: "/a", recentTypes: types }))).toBe(
    "demo/ping · agent/turn-started",
  );
  expect(contextRowDetail(listing({ path: "/a", recentTypes: types, description: "Mail" }))).toBe(
    "Mail",
  );
});

test.for([
  { name: "no events", types: [], expected: [] },
  {
    name: "a run of one type is one entry with its count, the newest first",
    types: ["a/x", "b/y", "b/y", "b/y", "a/x"],
    expected: [
      { type: "a/x", count: 1, at: 4 },
      { type: "b/y", count: 3, at: 3 },
      { type: "a/x", count: 1, at: 0 },
    ],
  },
])("the last events: $name", ({ types, expected }) => {
  // exact: no entry more and none less
  expect(eventRunsOf(types)).toEqual(expected);
});

function listing(row: Partial<ContextListing> & { path: string }): ContextListing {
  return { eventCount: 0, eventTypes: {}, recentTypes: [], processors: [], ...row };
}
