// @vitest-environment jsdom
// The Dash's agent pages: the home says what waits for the member in a place of its own (nothing,
// or the requests and the integrations that ask for them), New agent is a composer alone, and the
// agent view draws any path under one header row (the path, and Chat | Events), with the agent's
// status at the feed's foot, and says the opener once into an empty chat.
import { act, Suspense, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { BotIcon } from "lucide-react";
import { DashAgents, DashHome } from "./dash-agents.tsx";
import { AppShell } from "#/components/app-shell.tsx";
import type { DashPage, DashPageProps } from "#/components/dash/dash.tsx";
import { agentRowsOf } from "#/lib/agent-summary.ts";

const now = new Date().toISOString();
const agents = agentRowsOf({
  agents: {
    "/agents/onboarding": { createdAt: now, kind: "iterate", title: "Set up the mind" },
  },
});

test("the home with nothing waiting: the composer, the words that say so, and the recent agents", async () => {
  const { itx } = mind({});
  await using page = await draw(DashHome, itx, { waiting: 0 });
  await composerOf(page.host);
  const waiting = page.host.querySelector('section[aria-labelledby="needs-you"]');
  expect(waiting?.textContent).toBe("Waiting for youNothing waits for you.");
  expect(
    page.host.querySelector('[data-agent-path="/agents/onboarding"]')?.getAttribute("href"),
  ).toBe("?agent=/agents/onboarding");
});

test("the home before the count of what waits is known says nothing false, in the same room", async () => {
  const { itx } = mind({});
  await using page = await draw(DashHome, itx, { waiting: undefined });
  const waiting = page.host.querySelector('section[aria-labelledby="needs-you"]');
  expect(waiting?.textContent).toBe("Waiting for youLooking…");
  // one row's room, kept while it is read: the list under it does not move for the answer
  expect([...waiting!.classList]).toContain("min-h-22");
});

test("the home with something waiting: the requests, and each integration that asks", async () => {
  const { itx } = mind({
    serves: ["itx.integrations"],
    integrations: {
      integrations: {
        slack: { title: "Slack", status: { kind: "attention", text: "Connect a workspace" } },
        github: { title: "GitHub", status: { kind: "ok" } },
      },
      connections: {
        "github/acme": { account: "acme", status: { kind: "error", text: "The app was removed" } },
      },
    },
  });
  await using page = await draw(DashHome, itx, { waiting: 2 });
  const rows = [...page.host.querySelectorAll('section[aria-labelledby="needs-you"] li a')].map(
    (row) => [row.textContent, row.getAttribute("href")],
  );
  expect(rows).toEqual([
    [
      "2 requests wait for your yesYour agents wait until you answer.",
      "https://iterate.example.com/secrets/approvals",
    ],
    ["SlackConnect a workspace", "?page=integrations"],
    ["GitHub: acmeThe app was removed", "?page=integrations"],
  ]);
});

test("the agent view takes any path, has no button to its raw view, and says the opener once into an empty chat", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const { itx, appended } = mind({});
  history.replaceState(null, "", "/?agent=/agents/onboarding");
  await using page = await draw(DashAgents, itx, {
    waiting: 0,
    openers: { "/agents/onboarding": "Begin with step 1." },
  });
  expect(page.host.textContent).toContain("/agents/onboarding");
  expect(page.host.textContent).not.toContain("Raw view");
  expect(appended).toEqual([
    {
      path: "/agents/onboarding",
      events: [
        {
          type: "events.iterate.com/agent/context-added",
          idempotencyKey: "opener:/agents/onboarding",
          payload: { role: "developer", content: "Begin with step 1." },
        },
      ],
    },
  ]);
  // a path that is no agent's draws as well, and an opener for another path says nothing
  history.replaceState(null, "", "/?agent=/secrets/slack");
  await using other = await draw(DashAgents, itx, { waiting: 0, openers: {} });
  expect(other.host.textContent).toContain("/secrets/slack");
  expect(appended).toHaveLength(1);
});

test.for<{ name: string; path: string; kind: string }>([
  { name: "an iterate agent", path: "/agents/onboarding", kind: "iterate" },
  { name: "an agent of a kind with its own view", path: "/agents/session", kind: "claude" },
])(
  "$name: one header row holds the path and Chat | Events, no strip stands over the feed, and Events in the header is the Events tab",
  async ({ path, kind }) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { itx } = mind({ kinds: { claude: "agent-kinds/claude.ts" } });
    history.replaceState(null, "", `/?agent=${path}`);
    await using page = await draw(DashAgents, itx, {
      waiting: 0,
      agents: agentRowsOf({ agents: { [path]: { createdAt: now, kind } } }),
    });
    const header = page.host.querySelector("[data-page-header]");
    expect(header?.textContent).toContain(path);
    // the page's only tabs are the header's: the view under it draws no strip
    const tabs = [...page.host.querySelectorAll("[role=tablist]")];
    expect(tabs.map((list) => header?.contains(list))).toEqual([true]);
    expect(tabs[0]?.closest("[inert]")).toBe(null);
    if (kind === "iterate")
      // the agent's status is a line at the feed's foot, over the composer (this mind has no live
      // state to read)
      expect(page.host.querySelector("[data-slot=agent-foot-status]")?.textContent).toBe(
        "Live state unavailable",
      );
    const events = [...tabs[0]!.querySelectorAll("[role=tab]")].find((tab) =>
      tab.textContent?.startsWith("Events"),
    );
    await act(async () => (events as HTMLElement).click());
    await page.settle();
    expect(new URLSearchParams(location.search).get("view")).toBe('{"view":"events"}');
    // an iterate agent's Events tab is drawn in this page; a kind's, in its frame, which the page
    // tells (frame-view.test.tsx draws it)
    if (kind === "iterate")
      expect(page.host.textContent).toContain("Nothing has happened on this agent yet.");
  },
);

test("the agent page while its view is not there: the header's tabs, which cannot be pressed, and one loading line", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const { itx } = mind({});
  history.replaceState(null, "", "/?agent=/agents/onboarding");
  await using page = await draw(DashAgents, itx, { waiting: 0, agents: "unread" });
  const tabs = [...page.host.querySelectorAll("[role=tablist]")];
  expect(tabs).toHaveLength(1);
  expect(tabs[0]?.closest("[data-page-header] [inert]")).not.toBe(null);
  expect(page.host.querySelectorAll("[data-slot=log-reading]")).toHaveLength(1);
});

test("a chat draws a message's image for an agent whose context has no `files`: the mind signs its URL", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  using _layout = laidOut();
  const path = "/agents/claude/c";
  const file = { contentType: "image/png", filename: "photo.png", path: `${path}/photo.png` };
  const { itx } = mind({
    logs: {
      [path]: [
        {
          offset: 1,
          type: "events.iterate.com/agent/context-added",
          payload: { role: "user", content: "A photo", files: [{ ...file, size: 3 }] },
        },
      ],
    },
  });
  history.replaceState(null, "", `/?agent=${path}`);
  await using page = await draw(DashAgents, itx, { waiting: 0 });
  await act(() =>
    vi.waitFor(() =>
      expect(page.host.querySelector('img[alt="photo.png"]')?.getAttribute("src")).toBe(
        `https://files.example.com${file.path}`,
      ),
    ),
  );
});

test("an agent of another kind, before the catalog says its kind: no chat of iterate's, and never its words for an empty chat", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const { itx } = mind({ kinds: { claude: "agent-kinds/claude.ts" } });
  history.replaceState(null, "", "/?agent=/agents/session");
  await using page = await draw(DashAgents, itx, { waiting: 0, agents: "unread" });
  // the header is there, and one loading state: no view is chosen yet
  expect(page.host.textContent).toContain("/agents/session");
  expect(page.host.querySelectorAll("[data-slot=log-reading]")).toHaveLength(1);
  expect(page.host.querySelector("[role=log]")).toBe(null);
  expect(page.host.querySelector("iframe")).toBe(null);
  // the catalog answers: the kind's own view, in its frame, under the same loading state until
  // the frame has drawn a log that answered
  await page.draw(
    agentRowsOf({ agents: { "/agents/session": { createdAt: now, kind: "claude" } } }),
  );
  expect(page.host.querySelector("iframe")).not.toBe(null);
  expect(page.host.querySelectorAll("[data-slot=log-reading]")).toHaveLength(1);
  expect(page.host.querySelector("[role=log]")).toBe(null);
  expect(page.said.filter((text) => text.includes("Nothing said"))).toEqual([]);
});

test("a kind's file that cannot be read is read once: its agent's view draws, and no later render reads again", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const { itx, reads } = mind({ kinds: { claude: "agent-kinds/claude.ts" }, unreadable: true });
  history.replaceState(null, "", "/?agent=/agents/session");
  const rows = () =>
    agentRowsOf({ agents: { "/agents/session": { createdAt: now, kind: "claude" } } });
  await using page = await draw(DashAgents, itx, { waiting: 0, agents: rows() });
  // drawn again, as each change of a live catalog draws it
  for (let again = 0; again < 3; again += 1) await page.draw(rows());
  expect(reads()).toBe(1);
  expect(page.host.textContent).toContain("/agents/session");
  expect(page.host.textContent).not.toContain("Loading the page…");
});

test("an iterate agent, before the catalog says its kind, waits under the same loading state, then is iterate's chat", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const { itx } = mind({});
  history.replaceState(null, "", "/?agent=/agents/onboarding");
  await using page = await draw(DashAgents, itx, { waiting: 0, agents: "unread" });
  expect(page.host.querySelectorAll("[data-slot=log-reading]")).toHaveLength(1);
  expect(page.host.querySelector("[role=log]")).toBe(null);
  await page.draw(agents);
  // the log of this mind is empty and has answered: now, and only now, the chat says so
  expect(page.host.querySelector("[role=log]")?.textContent).toContain("Nothing said yet");
  expect(page.host.querySelector("[data-slot=log-reading]")).toBe(null);
});

test("the Agents page of a mind with folders and no agent says so, and counts none", async () => {
  const { itx } = mind({});
  history.replaceState(null, "", "/?page=agents");
  const folders = agentRowsOf({
    agents: {
      "/agents/people": { createdAt: now },
      "/agents/people/jo": { createdAt: now },
    },
  });
  await using page = await draw(DashAgents, itx, { waiting: 0, agents: folders });
  expect(page.host.textContent).toContain("0 agents");
  expect(page.host.textContent).toContain("No agents yet.");
  expect(page.host.querySelector('[aria-label="Every agent"]')).toBe(null);
});

test("New agent is the composer alone, on the home and the Agents page, whatever kinds the mind has", async () => {
  const { itx } = mind({ kinds: { claude: "agent-kinds/claude.ts" } });
  for (const [Page, url] of [
    [DashHome, "/"],
    [DashAgents, "/?page=agents"],
  ] as const) {
    history.replaceState(null, "", url);
    await using page = await draw(Page, itx, { waiting: 0 });
    await composerOf(page.host);
    // no choice of kind, and no kind's frame loaded for one
    expect(page.host.querySelector("select")).toBe(null);
    expect(page.host.querySelector("iframe")).toBe(null);
  }
});

/** A mind whose logs are empty but for `logs`: what the page appends is kept in `appended`.
 *  `kinds`: each kind's file in the config repo, by kind. Its root has `files`, and a context has
 *  none: only an iterate agent's context links to the root, and the page must not count on it. */
function mind({
  serves = [],
  integrations,
  kinds,
  unreadable = false,
  logs = {},
}: {
  serves?: string[];
  integrations?: object;
  kinds?: Record<string, string>;
  /** the config repo refuses each read of a file, on a connection that is up */
  unreadable?: boolean;
  logs?: Record<string, { offset: number; type: string; payload: object }[]>;
}) {
  const appended: { path: string; events: unknown[] }[] = [];
  let reads = 0;
  const contextOf = (path: string) => ({
    readEvents: async (after = 0) => {
      const held = (logs[path] || []).map((event) => ({ ...event, path, createdAt: now }));
      return {
        events: held.filter((event) => event.offset > after),
        atHead: true,
        scannedThroughOffset: held.at(-1)?.offset || 0,
      };
    },
    subscribe: async () => ({ [Symbol.dispose]() {} }),
    subscriptions: { list: async () => [] },
    rpcStubs: { list: async () => [] },
    invoke: async () => ({ rev: 1, state: path === "/integrations" ? integrations : {} }),
    append: async (...events: unknown[]) => {
      appended.push({ path, events });
    },
    [Symbol.dispose]() {},
  });
  const itx = {
    kv: {
      get: async (key: string) => (key === "agent-kinds" && kinds ? JSON.stringify(kinds) : null),
    },
    repos: {
      get: () => ({
        readFile: async () => {
          reads += 1;
          if (unreadable) throw new Error("no such file");
          return kinds ? "export default {};" : null;
        },
      }),
    },
    rewriteRules: { get: async (root: string) => (serves.includes(root) ? { target: "x" } : null) },
    cd: async (path: string) => contextOf(path),
    files: {
      get: (path: string) => ({
        url: async () => ({ url: `https://files.example.com${path}` }),
        [Symbol.dispose]() {},
      }),
    },
  } as unknown as DashPageProps["itx"];
  return { itx, appended, reads: () => reads };
}

/** A page with height, which jsdom lacks, so the chat's virtual log draws its rows; disposing takes
 *  it back. */
function laidOut() {
  const sizes = { clientHeight: 600, offsetHeight: 0 };
  const own = Object.keys(sizes).map(
    (name) => [name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name)] as const,
  );
  for (const [name, value] of Object.entries(sizes))
    Object.defineProperty(HTMLElement.prototype, name, { configurable: true, get: () => value });
  return {
    [Symbol.dispose]: () => {
      for (const [name, descriptor] of own)
        if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor);
        // the cast: the prototype's own keys are not indexable by a string in its type
        else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
    },
  };
}

/** The new-agent composer of a drawn page. Its editor is a part that loads after the page drew,
 *  so this waits for the element, not for a time. */
function composerOf(host: HTMLElement) {
  return act(() =>
    vi.waitFor(() => {
      const composer = host.querySelector('[aria-label="Message a new agent"], [data-placeholder]');
      expect(composer).not.toBe(null);
      return composer;
    }),
  );
}

async function draw(
  Page: (props: DashPageProps) => ReactNode,
  itx: DashPageProps["itx"],
  {
    waiting,
    openers,
    agents: first = agents,
  }: {
    /** How many requests wait; undefined: the count is not known yet. */
    waiting: number | undefined;
    openers?: Record<string, string>;
    /** The catalog of the mind's agents; "unread": it has not answered yet. */
    agents?: typeof agents | "unread";
  },
) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.stubGlobal("fetch", async () => Response.json({ minds: [], lastUsed: null }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  const row = (id: string): DashPage => ({ id, name: id, icon: BotIcon, component: () => null });
  const pages = [row("home"), { ...row("agents"), openers }, row("contexts"), row("integrations")];
  const host = document.body.appendChild(document.createElement("div"));
  // every text the page showed, at any moment
  const said: string[] = [];
  const watcher = new MutationObserver(() => said.push(host.textContent || ""));
  watcher.observe(host, { childList: true, subtree: true, characterData: true });
  const root = createRoot(host);
  const settle = async () => {
    // the page's parts load, its reads answer, and the chat reads the log
    for (let round = 0; round < 200 && host.textContent?.includes("Loading the page…"); round++)
      await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    // the log is published at most once a frame
    for (let round = 0; round < 10; round++)
      await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
  };
  const drawWith = async (rows: typeof agents | undefined) => {
    await act(() =>
      root.render(
        <AppShell
          app="Dash"
          mind="example.com"
          mindHref={() => "./"}
          account={null}
          locationKey="/"
        >
          <Suspense fallback="Loading the page…">
            <Page
              itx={itx}
              mind="example.com"
              principal={{ actor: "/members/a", email: "jo@example.com" }}
              page={pages[1]!}
              pages={pages}
              links={[]}
              catalog={undefined}
              agents={rows}
              waiting={waiting}
            />
          </Suspense>
        </AppShell>,
      ),
    );
    await settle();
  };
  await drawWith(first === "unread" ? undefined : first);
  return {
    host,
    said,
    /** Draw again with the catalog's answer. */
    draw: drawWith,
    settle,
    [Symbol.asyncDispose]: async () => {
      watcher.disconnect();
      await act(() => root.unmount());
      host.remove();
    },
  };
}
