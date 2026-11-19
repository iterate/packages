// @vitest-environment jsdom
// The integrations page while its registry has not answered, and once it has; and a button that
// changes something, which asks first and posts from the page.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { IntegrationsPage } from "./integrations-page.tsx";

test("a page with no seed says that it loads, and nothing about the registry, until the registry answers", async () => {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  await act(() => root.render(<IntegrationsPage openRegistry={neverOpens} deps={[]} />));
  expect(host.textContent).toContain("Loading…");
  expect(host.textContent).not.toContain("Nothing is connected yet");
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
        seed={{ rev: 1, state: { integrations: {}, connections: {} } }}
      />,
    ),
  );
  expect(host.textContent).toContain("Nothing is connected yet");
  await act(() =>
    root.render(
      <IntegrationsPage
        openRegistry={neverOpens}
        deps={[]}
        seed={{
          rev: 2,
          state: {
            integrations: {
              mail: {
                title: "Mail",
                actions: [{ label: "Open", url: "https://agents.example.com/" }],
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
  expect(host.textContent).not.toContain("Nothing is connected yet");
  // a button is a link to its URL
  expect([...host.querySelectorAll("a")].map((link) => link.getAttribute("href"))).toEqual([
    "https://agents.example.com/",
  ]);
  await act(() => root.unmount());
});

test("a button with a question asks it first and posts to its URL on the page's origin; one for another origin is not drawn", async () => {
  const posted: { url: string; method: string }[] = [];
  const answers = [
    new Response("Could not remove the account: the vault said no", { status: 400 }),
  ];
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    posted.push({ url, method: init?.method || "GET" });
    return answers.shift() || Response.json({ ok: true });
  });
  vi.stubGlobal("fetch", fetch);
  const here = window.location.origin;
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  await act(() =>
    root.render(
      <IntegrationsPage
        openRegistry={neverOpens}
        deps={[]}
        seed={{
          rev: 1,
          state: {
            integrations: { x: { title: "X", actions: [] } },
            connections: {
              "x/x-2": {
                account: "@ada",
                actions: [
                  { label: "Manage", url: `${here}/?page=secrets` },
                  {
                    label: "Remove",
                    url: `${here}/remove/x?secret=x-2`,
                    confirm: "Remove @ada? The mind deletes /secrets/x-2.",
                  },
                  {
                    label: "Erase",
                    url: "https://elsewhere.example/erase",
                    confirm: "Erase it elsewhere?",
                  },
                ],
              },
            },
          },
        }}
      />,
    ),
  );
  // the link stays a link; the change is a button, and the other origin's change is not drawn
  expect([...host.querySelectorAll("a")].map((link) => link.textContent)).toEqual(["Manage"]);
  expect([...document.querySelectorAll("button")].map((each) => each.textContent)).toEqual([
    "Remove",
  ]);
  // the trigger is in the row; the dialog's buttons are in its own layer, outside the page
  const press = async (text: string, inDialog = true) => {
    const button = [...document.querySelectorAll('[role="alertdialog"] button, button')].find(
      (each) => each.textContent === text && host.contains(each) !== inDialog,
    ) as HTMLButtonElement | undefined;
    await act(async () => button?.click());
  };
  const ask = () => press("Remove", false);

  // the first press only asks: nothing is sent
  await ask();
  expect(document.querySelector('[role="alertdialog"] h2')?.textContent).toBe("Remove @ada?");
  expect(document.body.textContent).toContain("The mind deletes /secrets/x-2.");
  expect(posted.length).toBe(0);
  await press("Cancel");
  expect(posted.length).toBe(0);

  // a yes posts; a refusal shows its own words
  await ask();
  await press("Remove");
  await act(async () => {});
  expect(posted).toEqual([{ url: `${here}/remove/x?secret=x-2`, method: "POST" }]);
  expect(host.querySelector('[role="alert"]')?.textContent).toBe(
    "Could not remove the account: the vault said no",
  );
  // a second yes is sent again, and its words go
  await ask();
  await press("Remove");
  await act(async () => {});
  expect(posted.length).toBe(2);
  expect(Boolean(host.querySelector('[role="alert"]'))).toBe(false);
  await act(() => root.unmount());
  vi.unstubAllGlobals();
});

/** A registry whose context never opens: the page waits on it. */
const neverOpens = () => new Promise<never>(() => {});
