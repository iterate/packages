// @vitest-environment jsdom
// The hook that the Dash reads the catalog with: the mind pushes the rows, and a mind without
// `contexts.watch` is asked for the list as before.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import type { CatalogItx } from "./catalog-collection.ts";
import { useWatchedContextCatalog } from "./context-catalog-live.ts";
import type { ContextListing } from "./context-catalog-rows.ts";
import { fakeCatalog } from "#/test-support/fake-catalog.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

test("the rows are the catalog's window, the newest first, each with its awake row, and a write is pushed", async () => {
  const catalog = fakeCatalog();
  catalog.put("/agents/a", 10, { description: "the first", eventCount: 3 });
  catalog.put("/agents/b", 20);
  const list = vi.fn(() => Promise.resolve([]));
  using page = await drawn(catalog.itx, list);
  expect(page.last()?.rows?.map((row) => [row.path, row.awake?.since])).toEqual([
    ["/agents/b", undefined],
    ["/agents/a", undefined],
  ]);
  // a watched row is a listing: what the views read of it is there
  expect(page.last()?.rows?.[1]).toMatchObject({ description: "the first", eventCount: 3 });

  await act(async () => {
    catalog.putAwake("/agents/a", 30);
    await settled();
  });
  expect(page.last()?.rows?.map((row) => [row.path, row.awake?.since])).toEqual([
    ["/agents/a", 30],
    ["/agents/b", undefined],
  ]);
  expect(page.last()?.error).toBeUndefined();
  // one watch that asks whether the mind answers one; then two for the page's life, the window
  // and the awake list; and no poll
  expect(catalog.calls.map((call) => call.query)).toEqual([
    { awake: true },
    { order: "active", limit: 500 },
    { awake: true },
  ]);
  expect([...catalog.watching].map((watch) => watch.query)).toEqual([
    { order: "active", limit: 500 },
    { awake: true },
  ]);
  expect(list).not.toHaveBeenCalled();
});

test("a mind without contexts.watch is asked for the list, and the page says no error", async () => {
  const listing: ContextListing = {
    path: "/agents/a",
    eventCount: 1,
    eventTypes: {},
    recentTypes: [],
    processors: [],
  };
  const list = vi.fn(() => Promise.resolve([listing]));
  const itx: CatalogItx = {
    contexts: { watch: () => Promise.reject(new Error("No such method: contexts.watch")) },
  };
  const errors = vi.spyOn(console, "error");
  using page = await drawn(itx, list);
  expect(page.last()).toEqual({ rows: [listing], error: undefined });
  expect(list).toHaveBeenCalledTimes(1);
  // the refusal is an answer: nothing failed, so nothing is said on the console
  expect(errors).not.toHaveBeenCalled();
});

/** Draws the hook, and answers what it last returned. */
async function drawn(itx: CatalogItx, list: () => Promise<unknown>) {
  const seen: { rows: ContextListing[] | undefined; error: string | undefined }[] = [];
  function Rows() {
    seen.push(useWatchedContextCatalog(itx, list, { of: "mind.example.com" }));
    return null;
  }
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () => {
    root.render(<Rows />);
    await settled();
  });
  return {
    last: () => seen.at(-1),
    [Symbol.dispose]: () => {
      act(() => root.unmount());
    },
  };
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 5));
