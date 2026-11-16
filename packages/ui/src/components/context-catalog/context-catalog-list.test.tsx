// @vitest-environment jsdom
// One row of the Contexts list: what its lines say. The list: where each row is.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { ContextCatalogList, ContextCatalogRow } from "./context-catalog-list.tsx";
import type { ContextListing } from "./context-catalog-rows.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const row: ContextListing = {
  path: "/agents/web/mail",
  eventCount: 3,
  eventTypes: {},
  recentTypes: ["events.iterate.com/agent/turn-started", "demo/ping"],
  processors: [],
  description: "Answers the mail",
  metadata: { title: "Mail desk" },
};

test.for([
  {
    name: "with a title: the title, the path, the description",
    shown: row,
    lines: ["Mail desk", "/agents/web/mail", "Answers the mail"],
  },
  {
    name: "with a title and no description: the title, the path, the last event types",
    shown: { ...row, description: undefined },
    lines: ["Mail desk", "/agents/web/mail", "demo/ping · agent/turn-started"],
  },
  {
    name: "no title: the path, the description",
    shown: { ...row, metadata: undefined },
    lines: ["/agents/web/mail", "Answers the mail"],
  },
  {
    name: "no title and no description: the path, the last event types",
    shown: { ...row, metadata: undefined, description: undefined },
    lines: ["/agents/web/mail", "demo/ping · agent/turn-started"],
  },
  {
    name: "no title, no description and no recent types: the path, how many events",
    shown: { ...row, metadata: undefined, description: undefined, recentTypes: [] },
    lines: ["/agents/web/mail", "3 events"],
  },
])("a row of the list, $name", ({ shown, lines }) => {
  expect(linesOf(shown)).toEqual(lines);
});

test("a row is as tall as the browser's text makes it, and one line taller with a title", async () => {
  // the browser's default font size, as its settings make it: twice the usual 16 px
  document.documentElement.style.fontSize = "32px";
  using _ = laidOut();
  const rows = [
    { ...row, path: "/a" },
    { ...row, path: "/b", metadata: undefined },
    { ...row, path: "/c" },
  ];
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () =>
    root.render(<ContextCatalogList rows={rows} links={{ hrefOf: (path) => path }} nowMs={0} />),
  );
  const items = [...document.querySelectorAll<HTMLElement>("ul li")];
  // a row with a title is 3.75rem, one without 2.75rem: 120 px and 88 px at 32 px
  expect(items.map((item) => [item.style.transform, item.style.height])).toEqual([
    ["translateY(0px)", "3.75rem"],
    ["translateY(120px)", "2.75rem"],
    ["translateY(208px)", "3.75rem"],
  ]);
  expect(document.querySelector<HTMLElement>("ul")?.style.height).toBe("328px");
  act(() => root.unmount());
  document.body.replaceChildren();
  document.documentElement.style.fontSize = "";
});

function linesOf(shown: ContextListing): string[] {
  const html = renderToStaticMarkup(
    <ContextCatalogRow
      row={shown}
      current={undefined}
      links={{ hrefOf: (path) => `?context=${path}` }}
      nowMs={0}
    />,
  );
  // the text of each span that has no element inside: the row's lines, the time aside
  return [...html.matchAll(/<span[^>]*>([^<]+)<\/span>/g)].map((match) => match[1]!);
}

/** A page with height, which jsdom lacks, so the virtual list draws its rows; disposing takes it
 *  back. */
function laidOut() {
  const sizes = { clientHeight: 600, clientWidth: 800 };
  const own = Object.keys(sizes).map(
    (name) => [name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name)] as const,
  );
  for (const [name, value] of Object.entries(sizes))
    Object.defineProperty(HTMLElement.prototype, name, { configurable: true, get: () => value });
  return {
    [Symbol.dispose]: () => {
      for (const [name, descriptor] of own)
        if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor);
        else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
    },
  };
}
