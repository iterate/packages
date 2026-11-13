// The integrations page in a server render: no browser, so no `window`. A TanStack Start app
// renders its pages on a server first.
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import { IntegrationsPage } from "./integrations-page.tsx";

test("a card with a link draws in a server render, where the page has no origin to compare the link's with", () => {
  expect(globalThis.window).toBeUndefined();
  const html = renderToString(
    <IntegrationsPage
      openRegistry={() => new Promise<never>(() => {})}
      deps={[]}
      mind="example.com"
      seed={{
        rev: 1,
        state: {
          integrations: {
            github: {
              title: "GitHub",
              actions: [{ label: "Open", url: "https://github.com/apps/example" }],
            },
          },
          connections: {},
        },
      }}
    />,
  );
  expect(html).toContain("GitHub");
  expect(html).toContain('href="https://github.com/apps/example"');
});
