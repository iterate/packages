// @vitest-environment jsdom
// The integrations page while its registry has not answered, and once it has; a button that
// changes something, which asks first and posts from the page; and a button that calls one
// function of the mind's config at the press, asking first only when its row has a confirm.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { INTEGRATION_CALLS } from "iterate/integrations";
import { codedError } from "iterate/lib";
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
                  { label: "Manage", url: `${here}/secrets` },
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

test("a call button with no confirm calls the one function it names on the press, with no dialog, is busy while it runs, and shows a failure's words", async () => {
  const calls: { name: string; args: unknown[] }[] = [];
  let fail: (error: Error) => void = () => {};
  const callConfig = vi.fn(async (name: string, args: unknown[]) => {
    calls.push({ name, args });
    return await new Promise<unknown>((_, reject) => (fail = reject));
  });
  const { host, unmount } = await draw(
    {
      integrations: {
        cloudflare: {
          title: "Cloudflare",
          actions: [{ label: "Connect", call: { name: "cloudflareConnect", args: [{ a: 1 }] } }],
        },
      },
      connections: {},
    },
    callConfig,
  );
  const button = () => host.querySelector("button");
  expect(button()?.textContent).toBe("Connect");
  // the whole call is the button's title and its accessible description
  expect(button()?.title).toBe('cloudflareConnect({"a":1})');
  expect(descriptionOf(button())).toBe('cloudflareConnect({"a":1})');
  // a press calls at once, with no dialog; a press while the call runs does nothing
  await pressAndSettle(host, "Connect");
  expect(Boolean(dialog())).toBe(false);
  await act(async () => button()?.click());
  expect(calls).toEqual([{ name: "cloudflareConnect", args: [{ a: 1 }] }]);
  expect(button()?.disabled).toBe(true);
  expect(button()?.getAttribute("aria-busy")).toBe("true");
  expect(button()?.textContent).toBe("Connect…");
  // the call fails: its words stand on the card as an error, and the button is idle again
  await act(async () => fail(new Error("the vault gave no answer")));
  expect(host.querySelector('[role="alert"]')?.textContent).toBe(
    "This button's call failed: the vault gave no answer",
  );
  expect(button()?.disabled).toBe(false);
  expect(button()?.textContent).toBe("Connect");
  await unmount();
});

test("the dialog of a button with confirm and the button's description show the whole call, escaped and left to right, and no sentence of the page's begins with the row's label", async () => {
  const { host, unmount } = await draw(
    {
      integrations: {
        x: {
          title: "X",
          actions: [
            {
              label: "This only reads. It never",
              call: {
                name: "removeCloudAccount",
                args: ["x".repeat(2000), "/secrets/github\u202e", "\u200b\u0430"],
              },
              confirm: "Remove every account? None can be connected again.",
            },
          ],
        },
      },
      connections: {},
    },
    async () => ({}),
    ["removeCloudAccount"],
  );
  const button = host.querySelector("button");
  await press(host, "This only reads. It never");
  // a long harmless first argument does not hide the second: the block scrolls
  const shown = callShown() || "";
  expect(descriptionOf(button)).toBe(shown);
  expect(button?.title).toBe(shown);
  expect(shown).toHaveLength(2068);
  expect(shown.endsWith('"/secrets/github\\u{202e}", "\\u{200b}\\u{430}")')).toBe(true);
  expect(shown).toMatch(/^[\x20-\x7e]*$/);
  const block = dialog()?.querySelector('[data-slot="call-text"]');
  expect(block?.getAttribute("dir")).toBe("ltr");
  expect(block?.className).toContain("overflow-auto");
  expect(block?.querySelector("bdi")?.getAttribute("dir")).toBe("ltr");
  // the label is the yes button's alone
  expect(dialog()?.textContent).not.toContain("It never calls");
  await unmount();
});

test("a call's link is followed in this tab only on the mind's own hosts; another is not, and the card names its host", async () => {
  const answers: unknown[] = [
    { link: "http://iterate.example.com/secrets/collect" },
    { link: "https://consent.example.net/start" },
    { link: "https://iterate.example.com/secrets/oauth/start?path=%2Fsecrets%2Fx", way: "x" },
  ];
  const { host, unmount } = await draw(
    {
      integrations: {
        x: { title: "X", actions: [{ label: "Connect", call: { name: "xConnect" } }] },
      },
      connections: {},
    },
    async () => answers.shift(),
  );
  const button = () => host.querySelector("button");
  await pressAndSettle(host, "Connect");
  expect(host.querySelector('[role="alert"]')?.textContent).toBe(
    "This button's call answered a link that is not https: the page does not follow it.",
  );
  await pressAndSettle(host, "Connect");
  expect(host.querySelector('[role="alert"]')?.textContent).toBe(
    "This button's call answered a link on consent.example.net, which is no host of this mind: the page does not follow it.",
  );
  // jsdom does not navigate: the button says where it goes, and stays busy while the page leaves
  await pressAndSettle(host, "Connect");
  expect(Boolean(host.querySelector('[role="alert"]'))).toBe(false);
  expect(button()?.textContent).toBe("Opening iterate.example.com…");
  expect(button()?.disabled).toBe(true);
  await unmount();
});

test("a Remove with confirm shows the dialog, the card's words above the call, and calls on yes; it says what the call answered", async () => {
  const calls: { name: string; args: unknown[] }[] = [];
  const { host, unmount } = await draw(
    {
      integrations: { x: { title: "X", actions: [] } },
      connections: {
        "x/x-2": {
          account: "@ada",
          actions: [
            {
              label: "Remove",
              call: { name: "removeCloudAccount", args: ["/secrets/x-2"] },
              confirm: "Remove @ada? The mind deletes /secrets/x-2.",
            },
          ],
        },
      },
    },
    async (name, args) => {
      calls.push({ name, args });
      return { secret: "/secrets/x-2", said: "Removed /secrets/x-2." };
    },
  );
  await press(host, "Remove");
  expect(dialog()?.querySelector("h2")?.textContent).toBe("Call this mind's config?");
  expect(dialog()?.querySelector("figure")?.textContent).toBe(
    "The card says:Remove @ada? The mind deletes /secrets/x-2.",
  );
  expect(callShown()).toBe('removeCloudAccount("/secrets/x-2")');
  expect(calls.length).toBe(0);
  await press(document.body, "Cancel");
  expect(calls.length).toBe(0);
  await pressAndYes(host, "Remove");
  expect(calls).toEqual([{ name: "removeCloudAccount", args: ["/secrets/x-2"] }]);
  expect(host.querySelector('p[role="status"]')?.textContent).toBe("Removed /secrets/x-2.");
  await unmount();
});

test("a button calls only a function that the config offers to buttons; a config that offers none says so and calls nothing", async () => {
  const calls: string[] = [];
  const state = {
    integrations: {
      x: { title: "X", actions: [{ label: "Refresh", call: { name: "slack", args: ["x"] } }] },
    },
    connections: {},
  };
  const record = async (name: string) => {
    calls.push(name);
    return {};
  };
  const offering = await draw(state, record, ["cloudflareConnect"]);
  await pressAndSettle(offering.host, "Refresh");
  expect(offering.host.querySelector('[role="alert"]')?.textContent).toBe(
    "This button calls slack, which this mind's config does not offer to buttons.",
  );
  await offering.unmount();
  // an empty offer, and a config with no `integrationCalls` method (an arrow field is none)
  for (const offered of [[], codedError("NOT_A_METHOD", "integrationCalls is no method")]) {
    const none = await draw(state, record, offered);
    await pressAndSettle(none.host, "Refresh");
    expect(none.host.querySelector('[role="alert"]')?.textContent).toBe(
      "This mind's config offers no function to buttons, so this button calls nothing.",
    );
    await none.unmount();
  }
  // an ask that fails otherwise says its own words
  const broken = await draw(state, record, new Error("the socket closed"));
  await pressAndSettle(broken.host, "Refresh");
  expect(broken.host.querySelector('[role="alert"]')?.textContent).toBe(
    "This button's call failed: the socket closed",
  );
  await broken.unmount();
  expect(calls).toEqual([]);
});

test("a page whose host gives no way to call draws a call button disabled, with a title that says why", async () => {
  const { host, unmount } = await draw(
    {
      integrations: {
        x: { title: "X", actions: [{ label: "Connect", call: { name: "xConnect" } }] },
      },
      connections: {},
    },
    undefined,
  );
  const button = host.querySelector("button");
  expect(button?.disabled).toBe(true);
  expect(button?.getAttribute("title")).toBe(
    "This page cannot call the mind's config: its host gave it no way to.",
  );
  expect(host.querySelectorAll("a").length).toBe(0);
  await unmount();
});

/** The page over a registry that has answered with `state`. */
async function draw(
  state: { integrations: Record<string, unknown>; connections: Record<string, unknown> },
  call: ((name: string, args: unknown[]) => Promise<unknown>) | undefined,
  offered: unknown = ["cloudflareConnect", "xConnect", "removeCloudAccount"],
) {
  // the config's offer to buttons, as `integrationCalls()` answers it; every other name is `call`'s
  const callConfig =
    call &&
    (async (name: string, args: unknown[]) => {
      if (name !== INTEGRATION_CALLS) return await call(name, args);
      if (offered instanceof Error) throw offered;
      return offered;
    });
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  await act(() =>
    root.render(
      <IntegrationsPage
        openRegistry={neverOpens}
        deps={[]}
        seed={{ rev: 1, state }}
        callConfig={callConfig}
        mind="iterate.example.com"
      />,
    ),
  );
  return {
    host,
    unmount: async () => {
      await act(() => root.unmount());
      host.remove();
    },
  };
}

/** The dialog that a press opened, if one is open. */
const dialog = () => document.querySelector('[role="alertdialog"]');

/** The call that the open dialog shows. */
const callShown = () => dialog()?.querySelector('[data-slot="call-text"]')?.textContent;

/** Presses the button inside `within` whose text is `text`. */
async function press(within: Element, text: string) {
  const button = [...within.querySelectorAll("button")].find((each) => each.textContent === text);
  await act(async () => button?.click());
}

/** The text of what `button` names as its accessible description. */
const descriptionOf = (button: Element | null | undefined) =>
  document.getElementById(button?.getAttribute("aria-describedby") || "")?.textContent;

/** Presses the page's button `label`, which acts at once, and lets the call answer. */
async function pressAndSettle(host: Element, label: string) {
  await press(host, label);
  await act(async () => {});
}

/** Presses the page's button `label`, then the dialog's yes, and lets the call answer. */
async function pressAndYes(host: Element, label: string) {
  await press(host, label);
  const yes = dialog()?.querySelector('[data-slot="alert-dialog-footer"] button:last-child');
  await act(async () => (yes as HTMLButtonElement | null | undefined)?.click());
  await act(async () => {});
}

/** A registry whose context never opens: the page waits on it. */
const neverOpens = () => new Promise<never>(() => {});
