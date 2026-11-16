// @vitest-environment jsdom
// The Dash's agent pages: the home says what waits for the member in a place of its own (nothing,
// or the requests and the integrations that ask for them), and the agent view draws any path, links
// to its raw view, and says the opener once into an empty chat.
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
  expect(
    page.host.querySelector('[aria-label="Message a new agent"], [data-placeholder]'),
  ).not.toBe(null);
  const waiting = page.host.querySelector('section[aria-labelledby="needs-you"]');
  expect(waiting?.textContent).toBe("Waiting for youNothing waits for you.");
  expect(
    page.host.querySelector('[data-agent-path="/agents/onboarding"]')?.getAttribute("href"),
  ).toBe("?agent=/agents/onboarding");
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

test("the agent view takes any path, links to its raw view, and says the opener once into an empty chat", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const { itx, appended } = mind({});
  history.replaceState(null, "", "/?agent=/agents/onboarding");
  await using page = await draw(DashAgents, itx, {
    waiting: 0,
    openers: { "/agents/onboarding": "Begin with step 1." },
  });
  expect(page.host.textContent).toContain("/agents/onboarding");
  expect(
    [...page.host.querySelectorAll("a")]
      .find((link) => link.textContent === "Raw view")
      ?.getAttribute("href"),
  ).toBe("?page=contexts&context=/agents/onboarding");
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

/** A mind of empty logs: what the page appends is kept in `appended`. */
function mind({ serves = [], integrations }: { serves?: string[]; integrations?: object }) {
  const appended: { path: string; events: unknown[] }[] = [];
  const contextOf = (path: string) => ({
    readEvents: async () => ({ events: [], atHead: true, scannedThroughOffset: 0 }),
    subscribe: async () => ({ [Symbol.dispose]() {} }),
    subscriptions: { list: async () => [] },
    rpcStubs: { list: async () => [] },
    invoke: async () => ({ rev: 1, state: path === "/integrations" ? integrations : {} }),
    append: async (...events: unknown[]) => {
      appended.push({ path, events });
    },
    files: { get: () => ({ url: async () => ({ url: "https://files.example.com/x" }) }) },
    [Symbol.dispose]() {},
  });
  const itx = {
    kv: { get: async () => null },
    repos: { get: () => ({ readFile: async () => null }) },
    rewriteRules: { get: async (root: string) => (serves.includes(root) ? { target: "x" } : null) },
    cd: async (path: string) => contextOf(path),
  } as unknown as DashPageProps["itx"];
  return { itx, appended };
}

async function draw(
  Page: (props: DashPageProps) => ReactNode,
  itx: DashPageProps["itx"],
  {
    waiting,
    openers,
    agents: rows = agents,
  }: { waiting: number; openers?: Record<string, string>; agents?: typeof agents },
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
  const root = createRoot(host);
  await act(() =>
    root.render(
      <AppShell app="Dash" mind="example.com" mindHref={() => "./"} account={null} locationKey="/">
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
  // the page's parts load, its reads answer, and the chat reads the log
  for (let round = 0; round < 200 && host.textContent?.includes("Loading the page…"); round++)
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
  // the log is published at most once a frame
  for (let round = 0; round < 10; round++)
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
  return {
    host,
    [Symbol.asyncDispose]: async () => {
      await act(() => root.unmount());
      host.remove();
    },
  };
}
