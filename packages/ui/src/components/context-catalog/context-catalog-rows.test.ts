// The plain functions over the catalog's rows: the parse, the filter, a row's words and its last
// events. The components that draw them are not covered here.
import { expect, test } from "vitest";
import {
  contextListingsOf,
  contextName,
  contextRowDetail,
  contextTitle,
  describedPayload,
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
  { name: "a word of the title", query: "ledger", expected: ["/x"] },
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
    listing({ path: "/x", metadata: { team: "billing", title: "The ledger" } }),
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

test("a row says its title · its description, either alone, or else its last event types, the newest first", () => {
  const types = ["events.iterate.com/agent/turn-started", "demo/ping"];
  const title = { title: "Desk" };
  expect(contextRowDetail(listing({ path: "/a", recentTypes: types }))).toBe(
    "demo/ping · agent/turn-started",
  );
  expect(contextRowDetail(listing({ path: "/a", recentTypes: types, description: "Mail" }))).toBe(
    "Mail",
  );
  expect(contextRowDetail(listing({ path: "/a", recentTypes: types, metadata: title }))).toBe(
    "Desk",
  );
  expect(contextRowDetail(listing({ path: "/a", description: "Mail", metadata: title }))).toBe(
    "Desk · Mail",
  );
});

test.for([
  { name: "a title is trimmed", metadata: { title: "  Desk " }, title: "Desk", named: "Desk" },
  { name: "no metadata has none", metadata: undefined, title: undefined, named: "mail" },
  { name: "a blank title is none", metadata: { title: "  " }, title: undefined, named: "mail" },
  {
    name: "a title that is no string is none",
    metadata: { title: 7 },
    title: undefined,
    named: "mail",
  },
  {
    name: "a long title is cut to 80",
    metadata: { title: "x".repeat(90) },
    title: "x".repeat(80),
    named: "x".repeat(80),
  },
])("the title: $name", ({ metadata, title, named }) => {
  const row = listing({ path: "/agents/mail", metadata });
  expect(contextTitle(row)).toBe(title);
  expect(contextName(row)).toBe(named);
});

test("the root's name is / when it has no title", () => {
  expect(contextName(listing({ path: "/" }))).toBe("/");
});

test.for([
  {
    name: "a title goes in with the rest of the metadata",
    metadata: { team: "billing", title: "Old" },
    description: "Mail",
    title: " Desk " as string | undefined,
    expected: { description: "Mail", metadata: { team: "billing", title: "Desk" } },
  },
  {
    name: "an empty title removes the title key",
    metadata: { team: "billing", title: "Old" },
    description: "",
    title: "",
    expected: { description: null, metadata: { team: "billing" } },
  },
  {
    name: "an empty title of metadata with nothing else clears the metadata",
    metadata: { title: "Old" },
    description: "Mail",
    title: "",
    expected: { description: "Mail", metadata: null },
  },
  {
    name: "without a title the metadata stays",
    metadata: { title: "Old" },
    description: "Mail",
    title: undefined,
    expected: { description: "Mail" },
  },
])("the described payload: $name", ({ metadata, description, title, expected }) => {
  // exact: a key more would overwrite what stood
  expect(describedPayload(listing({ path: "/a", metadata }), description, title)).toEqual(expected);
});

test("a title is not written where the metadata that stands is not known, or would be dropped", () => {
  // no row: the context's metadata is unknown, and a write would replace it
  expect(() => describedPayload(undefined, "Mail", "Desk")).toThrow("does not list this context");
  expect(describedPayload(undefined, "Mail")).toEqual({ description: "Mail" });
  // the catalog drops a record that prints longer than 4,000 characters, the title with it
  const long = listing({ path: "/a", metadata: { notes: "x".repeat(3_990) } });
  expect(() => describedPayload(long, "Mail", "Desk")).toThrow("too long");
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
