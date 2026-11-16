// @vitest-environment jsdom
// A mind's Dash drawn from lists: one list of pages makes the sidebar, the URL names the page shown, a part the mind does not have says "Off", and a page that fails says
// so in its own place.
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { BotIcon, ChartLineIcon, LayoutDashboardIcon, ShieldCheckIcon } from "lucide-react";
import { Dash, DashContexts, type DashPage } from "./dash.tsx";
import type { DashPageProps } from "./dash-pages.tsx";
import { go, usePageParam } from "#/lib/page-url.ts";

test("one list makes the sidebar; a mind with no telemetry shows Analytics as Off, and is asked once", async () => {
  await using dash = await draw("/", []);
  const { host } = dash;
  expect(host.querySelector("h1")?.textContent).toBe("example.com");
  // the sidebar's row leads to ?page=analytics, and says Off
  expect(linksNamed(host, "Analytics").map((link) => link.getAttribute("href"))).toEqual([
    "?page=analytics",
  ]);
  expect(host.textContent?.match(/Off/g)).toHaveLength(1);
  expect(linksNamed(host, "Home")[0]?.getAttribute("href")).toBe("./");
  // and each group of links follows the pages
  expect(linksNamed(host, "Approvals")).toHaveLength(1);
  expect(dash.asked.filter((root) => root === "itx.telemetry")).toHaveLength(1);
});

test("a mind with telemetry has no Off; a click on a page's row shows that page and keeps the sidebar", async () => {
  await using dash = await draw("/", ["itx.telemetry"]);
  const { host } = dash;
  expect(host.textContent).not.toContain("Off");
  const row = linksNamed(host, "Analytics")[0]!;
  await act(() => row.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 })));
  expect(location).toMatchObject({ search: "?page=analytics" });
  expect(host.textContent).toContain("the charts");
  expect(host.querySelector("h1")).toBeNull();
  expect(linksNamed(host, "Home")).toHaveLength(1);
});

test("a page that did not load says so on its own page alone, with the way to load again", async () => {
  // React reports what an error boundary caught
  vi.spyOn(console, "error").mockImplementation(() => {});
  await using dash = await draw("/?page=broken", []);
  const { host } = dash;
  expect(host.querySelector('[role="alert"]')?.textContent).toBe(
    "This page did not load: Failed to fetch dynamically imported module. Load the page again to try once more.",
  );
  // the sidebar stays, and another page draws as before
  await act(() => linksNamed(host, "Home")[0]!.click());
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(host.querySelector("h1")?.textContent).toBe("example.com");
});

test("with a Contexts page, ⌘K lists the contexts active in the last five minutes, and Enter shows one there", async () => {
  // the Contexts page draws the explorer, which this test's itx cannot open: its page says so
  vi.spyOn(console, "error").mockImplementation(() => {});
  const now = new Date().toISOString();
  const rows = [
    { path: "/agents/a", description: "Chases an invoice", lastActivityAt: now },
    { path: "/secrets/old", lastActivityAt: "2026-01-01T00:00:00.000Z" },
  ].map((row) => ({ eventCount: 1, eventTypes: {}, recentTypes: [], processors: [], ...row }));
  await using _dash = await draw("/", [], {
    pages: [...pages, { id: "contexts", name: "Contexts", icon: BotIcon, component: DashContexts }],
    contexts: rows,
  });
  await act(() =>
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true })),
  );
  const dialog = document.querySelector('[role="dialog"]');
  expect(dialog?.textContent).toContain("Active in the last 5 minutes");
  expect(
    [...document.querySelectorAll('[role="option"]')].map((row) => row.getAttribute("data-value")),
  ).toEqual(["/agents/a"]);
  await act(() =>
    document
      .querySelector("[cmdk-input]")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
  );
  expect(location).toMatchObject({ search: "?page=contexts&context=/agents/a" });
});

test("the Contexts page with no context: the list and a note, and no context opened, the root included", async () => {
  await using dash = await draw("/?page=contexts", [], {
    pages: withContexts,
    contexts: catalogRows,
  });
  const { host } = dash;
  await until(() => host.querySelector('nav[aria-label="Contexts"]'));
  expect(host.textContent).toContain("Pick a context from the list, or type a path.");
  expect(host.querySelector('input[aria-label="Filter or go to a path"]')).not.toBeNull();
  // the tree is the catalog's: the root and its two paths
  expect(host.textContent).toContain("3 contexts");
  expect(dash).toMatchObject({ opened: [] });
  // a path typed opens that context, the root too, and names it in the URL
  await act(() => go("?page=contexts&context=/agents/a"));
  await until(() => dash.opened.length);
  expect(dash).toMatchObject({ opened: ["/"] });
});

test("?context=/ opens the root, as a choice", async () => {
  // this test's itx cannot open the root: the page says so
  vi.spyOn(console, "error").mockImplementation(() => {});
  await using dash = await draw("/?page=contexts&context=/", [], {
    pages: withContexts,
    contexts: catalogRows,
  });
  await until(() => dash.opened.length);
  expect(dash).toMatchObject({ opened: ["/"] });
  expect(dash.host.textContent).not.toContain("Pick a context from the list");
  expect(dash.host.querySelector('[role="alert"]')?.textContent).toBe("no context /");
});

test("an agent that throws says so on its own view alone: View all and another agent draw again, and nothing else mounts the page anew", async () => {
  // React reports what an error boundary caught
  vi.spyOn(console, "error").mockImplementation(() => {});
  let mounts = 0;
  function Agents() {
    const agent = usePageParam("agent");
    useEffect(() => {
      mounts += 1;
    }, []);
    if (agent === "/agents/broken") throw new Error("the agent view threw");
    return <p data-shown>{agent || "every agent"}</p>;
  }
  await using dash = await draw("/?agent=/agents/broken", [], {
    pages: [...pages, { id: "agents", name: "Agents", icon: BotIcon, component: Agents }],
  });
  const { host } = dash;
  const alert = () => host.querySelector('[role="alert"]');
  const shown = () => host.querySelector("[data-shown]")?.textContent;
  expect(alert()?.textContent).toContain("the agent view threw");
  // View all: the same page, with no agent
  await act(() => go("?page=agents"));
  expect([alert(), shown()]).toEqual([null, "every agent"]);
  // another agent after one that threw
  await act(() => go("?agent=/agents/broken"));
  expect(alert()).not.toBeNull();
  await act(() => go("?agent=/agents/other"));
  expect([alert(), shown()]).toEqual([null, "/agents/other"]);
  // with no error, neither another agent nor the page's own view state mounts it anew
  const before = mounts;
  await act(() => go("?agent=/agents/third"));
  await act(() => go(`?agent=/agents/third&view=${encodeURIComponent('{"q":"x"}')}`));
  expect([shown(), mounts]).toEqual(["/agents/third", before]);
});

test("a page the URL does not name is the first page", async () => {
  await using dash = await draw("/?page=nothing-here", []);
  expect(dash.host.querySelector("h1")?.textContent).toBe("example.com");
});

test("the sidebar's agents: one row per agent and the agents below its path, newest first, six at most", async () => {
  const at = (day: number) => `2026-01-${String(day).padStart(2, "0")}T00:00:00.000Z`;
  const agents: Record<string, object> = {
    // seven agents at the top; /agents/a's subagents are newer than any of them
    ...Object.fromEntries(
      [1, 2, 3, 4, 5, 6, 7].map((day) => [
        `/agents/t${String(day)}`,
        {
          createdAt: at(1),
          kind: "iterate",
          title: `Agent ${String(day)}`,
          lastActivityAt: at(day),
        },
      ]),
    ),
    "/agents/a": { createdAt: at(1), kind: "iterate", title: "Parent", lastActivityAt: at(1) },
    ...Object.fromEntries(
      [1, 2, 3, 4, 5].map((n) => [
        `/agents/a/sub${String(n)}`,
        { createdAt: at(1), kind: "iterate", parent: "/agents/a", lastActivityAt: at(20) },
      ]),
    ),
  };
  await using dash = await draw("/", [], { pages: withAgentPages, agents });
  const rows = [...dash.host.querySelectorAll("[data-agent-path]")];
  expect(rows.map((row) => row.getAttribute("data-agent-path"))).toEqual([
    "/agents/a",
    "/agents/t7",
    "/agents/t6",
    "/agents/t5",
    "/agents/t4",
    "/agents/t3",
  ]);
  expect(rows[0]?.querySelector("[data-agent-line]")?.textContent).toBe("and 5 subagents");
  // each row is the agent view, and View all is the Agents page, which has no row of its own
  expect(rows[0]?.querySelector("a")?.getAttribute("href")).toBe("?agent=/agents/a");
  expect(linksNamed(dash.host, "View all")[0]?.getAttribute("href")).toBe("?page=agents");
  expect(linksNamed(dash.host, "Agents page")).toHaveLength(0);
  // the section is the sidebar's last: every other link is above the first agent's row
  const sidebarLinks = [...dash.host.querySelectorAll("a")];
  const firstAgent = sidebarLinks.findIndex((link) => link.closest("[data-agent-path]"));
  expect(
    sidebarLinks
      .slice(firstAgent)
      .every((link) => link.closest("[data-agent-path]") || link.textContent?.includes("View all")),
  ).toBe(true);
  // a click opens the agent view: the Agents page, with the path; its row is the current one
  await act(() => rows[1]!.querySelector("a")!.click());
  expect(location).toMatchObject({ search: "?agent=/agents/t7" });
  expect(dash.host.textContent).toContain("agent view of /agents/t7");
  expect(
    [...dash.host.querySelectorAll("[data-agent-path] a")].map((row) =>
      row.hasAttribute("data-active"),
    ),
  ).toEqual([false, true, false, false, false, false]);
});

test("⌘K is one palette on every page: Agents first, then Raw contexts, and / completes paths", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const now = new Date().toISOString();
  const contexts = [
    { path: "/agents/onboarding", lastActivityAt: now },
    { path: "/agents/people/jo/web/x", lastActivityAt: now },
    { path: "/secrets/slack", description: "Slack's token", lastActivityAt: now },
  ].map((row) => ({ eventCount: 1, eventTypes: {}, recentTypes: [], processors: [], ...row }));
  const agents = {
    "/agents/onboarding": {
      createdAt: now,
      kind: "iterate",
      title: "Onboarding",
      lastActivityAt: now,
    },
    "/agents/people/jo/web/x": { createdAt: now, kind: "iterate", title: "Pays a bill" },
  };
  // on a page that is neither the Agents page nor the Contexts page
  await using _dash = await draw("/?page=analytics", ["itx.telemetry"], {
    pages: withAgentPages,
    agents,
    contexts,
  });
  const options = () =>
    [...document.querySelectorAll('[role="option"]')].map((row) => row.getAttribute("data-value"));
  const input = () => document.querySelector<HTMLInputElement>("[cmdk-input]")!;
  const press = (key: string) =>
    act(() => input().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })));
  await openPalette();
  // the Agents tab: every agent, the newest first; Enter opens the agent view
  expect(options()).toEqual(["/agents/onboarding", "/agents/people/jo/web/x"]);
  await typeInto(input(), "bill");
  expect(options()).toEqual(["/agents/people/jo/web/x"]);
  await press("Enter");
  expect(location).toMatchObject({ search: "?agent=/agents/people/jo/web/x" });
  // the Raw contexts tab: any context; Enter opens the raw view
  await openPalette();
  await act(() =>
    [...document.querySelectorAll('[role="tab"]')]
      .at(1)!
      .dispatchEvent(new MouseEvent("click", { bubbles: true })),
  );
  await typeInto(input(), "slack");
  expect(options()).toEqual(["/secrets/slack"]);
  await press("Enter");
  expect(location).toMatchObject({ search: "?page=contexts&context=/secrets/slack" });
  // "/" first: the paths one level down; Tab completes one level, Enter opens the raw view
  await openPalette();
  await typeInto(input(), "/ag");
  expect(options()).toEqual(["/agents"]);
  await press("Tab");
  expect(input()).toMatchObject({ value: "/agents/" });
  expect(options()).toEqual(["/agents/onboarding", "/agents/people"]);
  await typeInto(input(), "/agents/pe");
  await press("Tab");
  expect(input()).toMatchObject({ value: "/agents/people/" });
  await press("Enter");
  expect(location).toMatchObject({ search: "?page=contexts&context=/agents/people/jo" });
});

async function openPalette() {
  await act(() =>
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true })),
  );
}

/** Types `value` into a React input, as a person would. */
async function typeInto(input: HTMLInputElement, value: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(() => {
    setValue.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const pages: DashPage[] = [
  {
    id: "home",
    name: "Home",
    icon: LayoutDashboardIcon,
    component: ({ mind }: DashPageProps) => <h1>{mind}</h1>,
  },
  {
    id: "analytics",
    name: "Analytics",
    icon: ChartLineIcon,
    serves: "telemetry",
    component: () => <p>the charts</p>,
  },
  {
    id: "broken",
    name: "Broken",
    icon: BotIcon,
    component: () => {
      throw new Error("Failed to fetch dynamically imported module");
    },
  },
];

/** The pages, with an Agents page and a Contexts page by their ids: the Agents page says which
 *  path it shows. */
const withAgentPages: DashPage[] = [
  ...pages,
  {
    id: "agents",
    name: "Agents page",
    icon: BotIcon,
    component: function AgentsPage() {
      const path = usePageParam("agent");
      return <p>{path ? `agent view of ${path}` : "every agent"}</p>;
    },
  },
  { id: "contexts", name: "Contexts", icon: BotIcon, component: DashContexts },
];

const withContexts: DashPage[] = [
  ...pages,
  { id: "contexts", name: "Contexts", icon: BotIcon, component: DashContexts },
];

const catalogRows = ["/agents/a", "/secrets/b"].map((path) => ({
  path,
  eventCount: 1,
  eventTypes: {},
  recentTypes: [],
  processors: [],
}));

const links = [
  {
    title: "Access",
    rows: [
      {
        name: "Approvals",
        href: "https://iterate.example.com/secrets/approvals",
        icon: ShieldCheckIcon,
        count: "approvals" as const,
      },
    ],
  },
];

/** The Dash at `url`, for a mind that serves the roots `serves` names and has no vault (nothing
 *  waits for approval). The sidebar asks the viewport's width, and the switcher this host's
 *  minds. */
async function draw(
  url: string,
  serves: string[],
  {
    pages: drawn = pages,
    contexts,
    agents,
  }: { pages?: DashPage[]; contexts?: unknown[]; agents?: Record<string, object> } = {},
) {
  history.replaceState(null, "", url);
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.stubGlobal("fetch", async () =>
    Response.json({ minds: [{ address: "example.com", lastUsedAt: 0 }], lastUsed: "example.com" }),
  );
  // jsdom lays nothing out: cmdk asks for both
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Element.prototype.scrollIntoView ||= () => {};
  const asked: string[] = [];
  const opened: string[] = [];
  const itx = {
    // a platform with no catalog rejects; `contexts` is a mind's catalog
    contexts: {
      list: async ({ under }: { under?: string } = {}) => {
        if (!contexts) throw new Error("No such method: contexts.list");
        return under ? [] : contexts;
      },
    },
    // the catalog of the mind's agents on /agents: its live state's seed, and no change after
    cd: async (path: string) => {
      opened.push(path);
      if (path !== "/agents" || !agents) throw new Error(`no context ${path}`);
      return {
        invoke: async () => ({ rev: 1, state: { agents } }),
        subscribe: async () => ({ [Symbol.dispose]() {} }),
        [Symbol.dispose]() {},
      };
    },
    rewriteRules: {
      get: async (root: string) => {
        asked.push(root);
        return serves.includes(root) ? { target: "x" } : null;
      },
    },
  } as unknown as DashPageProps["itx"];
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  await act(() =>
    root.render(
      <Dash
        app="Dash"
        itx={itx}
        mind="example.com"
        principal={{ actor: "/members/a", email: "a@example.com" }}
        pages={drawn}
        links={links}
      />,
    ),
  );
  await act(async () => {});
  return {
    host,
    asked,
    // every context opened but the catalog of agents
    get opened() {
      return opened.filter((path) => path !== "/agents");
    },
    [Symbol.asyncDispose]: async () => {
      await act(() => root.unmount());
      host.remove();
    },
  };
}

/** Up to four seconds for `check`: the Contexts page's part loads by `import()`. */
async function until(check: () => unknown) {
  for (let tick = 0; tick < 80 && !check(); tick += 1)
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
}

function linksNamed(host: Element, name: string) {
  return [...host.querySelectorAll("a")].filter((link) => link.textContent?.includes(name));
}
