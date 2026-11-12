// @vitest-environment jsdom
// The integrations page while its registry has not answered, and once it has.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test } from "vitest";
import { IntegrationsPage } from "./integrations-page.tsx";

test("a page with no seed says that it loads, and nothing about the registry, until the registry answers", async () => {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  await act(() =>
    root.render(<IntegrationsPage openRegistry={neverOpens} deps={[]} mind="example.com" />),
  );
  expect(host.textContent).toContain("Loading…");
  expect(host.textContent).not.toContain("No integrations are registered yet");
  await act(() => root.unmount());
});

test("a registry that has answered with no card says so, and one with a card draws it with its links", async () => {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  await act(() =>
    root.render(
      <IntegrationsPage
        openRegistry={neverOpens}
        deps={[]}
        mind="example.com"
        seed={{ rev: 1, state: { integrations: {}, connections: {} } }}
      />,
    ),
  );
  expect(host.textContent).toContain("No integrations are registered yet");
  await act(() =>
    root.render(
      <IntegrationsPage
        openRegistry={neverOpens}
        deps={[]}
        mind="example.com"
        seed={{
          rev: 2,
          state: {
            integrations: {
              mail: {
                title: "Mail",
                actions: [{ label: "Open", routingSlug: "agents", path: "/" }],
              },
            },
            connections: { "mail/one": { account: "@account", actions: [] } },
          },
        }}
      />,
    ),
  );
  expect(host.textContent).toContain("Mail");
  expect(host.textContent).toContain("@account");
  expect(host.textContent).not.toContain("No integrations are registered yet");
  // a place of the mind is a link to that host of the mind
  expect([...host.querySelectorAll("a")].map((link) => link.getAttribute("href"))).toEqual([
    "https://agents.example.com/",
  ]);
  await act(() => root.unmount());
});

/** A registry whose context never opens: the page waits on it. */
const neverOpens = () => new Promise<never>(() => {});
