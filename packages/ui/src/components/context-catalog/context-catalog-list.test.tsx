// One row of the Contexts list in each layout: what its two lines say.
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { ContextCatalogRow } from "./context-catalog-list.tsx";
import type { ContextListing, ContextRowLayout } from "./context-catalog-rows.ts";

const row: ContextListing = {
  path: "/agents/web/mail",
  eventCount: 3,
  eventTypes: {},
  recentTypes: [],
  processors: [],
  description: "Answers the mail",
  metadata: { title: "Mail desk" },
};

test("path-first: the path, then the title · the description", () => {
  expect(lines("path-first")).toEqual(["/agents/web/mail", "Mail desk · Answers the mail"]);
});

test("title-first: the title, then the path; a row without a title shows its path's last part", () => {
  expect(lines("title-first")).toEqual(["Mail desk", "/agents/web/mail"]);
  expect(lines("title-first", { ...row, metadata: undefined })).toEqual([
    "mail",
    "/agents/web/mail",
  ]);
});

function lines(layout: ContextRowLayout, shown = row): string[] {
  const html = renderToStaticMarkup(
    <ContextCatalogRow
      row={shown}
      current={undefined}
      links={{ hrefOf: (path) => `?context=${path}` }}
      nowMs={0}
      layout={layout}
    />,
  );
  // the text of each span that has no span inside: the path or the name, then the second line
  return [...html.matchAll(/<span[^>]*>([^<]+)<\/span>/g)].map((match) => match[1]!);
}
