// @vitest-environment jsdom
// A mind's Dash drawn from lists: one list of pages makes the sidebar, the URL names the page shown, a part the mind does not have says "Off", and a page that fails says
// so in its own place.
import { act, use, useEffect, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import {
  BotIcon,
  ChartLineIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  SettingsIcon,
  ShieldCheckIcon,
} from "lucide-react";
import type { Principal } from "iterate/principal";
import { Dash, DashContexts, DashSettings, type DashPage } from "./dash.tsx";
import type { DashLink, DashLinks, DashPageProps } from "./dash-pages.tsx";
import { ITX_SESSION, type ItxConnection } from "#/lib/itx-session.ts";
import { go, usePageParam } from "#/lib/page-url.ts";
import { askWaitingApprovals } from "#/lib/waiting-approvals.ts";

test("one list makes the sidebar; a mind with no telemetry shows Analytics as Off, and is asked once", async () => {
  await using dash = await draw("/", []);
  const { host } = dash;
  expect(host.querySelector("h1")?.textContent).toBe("iterate.example.com");
  // the sidebar's row leads to /analytics, and says Off
  expect(linksNamed(host, "Analytics").map((link) => link.getAttribute("href"))).toEqual([
    "/analytics",
  ]);
  expect(host.textContent?.match(/Off/g)).toHaveLength(1);
  // the header brand links Home (`/`), and Home is not repeated in the nav
  expect(headerBrandLink(host)?.getAttribute("href")).toBe("/");
  expect(linksNamed(host, "Home")).toHaveLength(0);
  expect(host.querySelector('[aria-label="Switch mind"]')).toBeNull();
  // with no `settings` page, `links` groups fall back to plain labelled sidebar groups so no link disappears
  expect(linksNamed(host, "Approvals")).toHaveLength(1);
  expect(dash.asked.filter((root) => root === "itx.telemetry")).toHaveLength(1);
});

test("a mind with telemetry has no Off; a click on a page's row shows that page and keeps the sidebar", async () => {
  await using dash = await draw("/", ["itx.telemetry"]);
  const { host } = dash;
  expect(host.textContent).not.toContain("Off");
  const row = linksNamed(host, "Analytics")[0]!;
  await act(() => row.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 })));
  expect(location).toMatchObject({ pathname: "/analytics", search: "" });
  expect(host.textContent).toContain("the charts");
  expect(host.querySelector("h1")).toBeNull();
  expect(headerBrandLink(host)?.getAttribute("href")).toBe("/");
});

test("a page that did not load says so on its own page alone, with the way to load again", async () => {
  // React reports what an error boundary caught
  vi.spyOn(console, "error").mockImplementation(() => {});
  await using dash = await draw("/broken", []);
  const { host } = dash;
  expect(host.querySelector('[role="alert"]')?.textContent).toBe(
    "This page did not load: Failed to fetch dynamically imported module. Load the page again to try once more.",
  );
  // the sidebar stays, and clicking the header brand returns Home
  await act(() => headerBrandLink(host)!.click());
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(host.querySelector("h1")?.textContent).toBe("iterate.example.com");
});

test("a page that threw is handed to the page's error capture, once, when the page has one", async () => {
  const reported: unknown[] = [];
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  window.reportPageError = (error) => reported.push(error);
  try {
    await using dash = await draw("/broken", []);
    expect(dash.host.querySelector('[role="alert"]')).not.toBeNull();
    expect(reported.map((error) => (error as Error).message)).toEqual([
      "Failed to fetch dynamically imported module",
    ]);
    // a capture that throws does not take the note away
    window.reportPageError = () => {
      throw new Error("the capture broke");
    };
    await act(() => headerBrandLink(dash.host)!.click());
    await act(() => go("/broken"));
    expect(dash.host.querySelector('[role="alert"]')?.textContent).toContain(
      "This page did not load",
    );
    // and the capture's own failure is said once in the console
    expect(
      errors.mock.calls.filter((call) =>
        String(call[0]).startsWith("The page's error capture failed"),
      ),
    ).toHaveLength(1);
  } finally {
    delete window.reportPageError;
  }
});

test("Dash renders no sidebar Search button and ⌘K opens no dialog", async () => {
  await using dash = await draw("/", [], {
    pages: withContexts,
    contexts: catalogRows,
  });
  expect(dash.host.textContent).not.toContain("Search");
  await act(() =>
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true })),
  );
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

test("the Contexts page with no context: the list and a note, and no context opened, the root included", async () => {
  await using dash = await draw("/contexts", [], {
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
  await act(() => go("/contexts/agents/a"));
  await until(() => dash.opened.length);
  expect(dash).toMatchObject({ opened: ["/"] });
});

test("/contexts?contextPath=/ opens the root, as a choice", async () => {
  // this test's itx cannot open the root: the page says so
  vi.spyOn(console, "error").mockImplementation(() => {});
  await using dash = await draw("/contexts?contextPath=/", [], {
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
  await using dash = await draw("/agents/agents/broken", [], {
    pages: [...pages, { id: "agents", name: "Agents", icon: BotIcon, component: Agents }],
  });
  const { host } = dash;
  const alert = () => host.querySelector('[role="alert"]');
  const shown = () => host.querySelector("[data-shown]")?.textContent;
  expect(alert()?.textContent).toContain("the agent view threw");
  // View all: the same page, with no agent
  await act(() => go("/agents"));
  expect([alert(), shown()]).toEqual([null, "every agent"]);
  // another agent after one that threw
  await act(() => go("/agents/agents/broken"));
  expect(alert()).not.toBeNull();
  await act(() => go("/agents/agents/other"));
  expect([alert(), shown()]).toEqual([null, "/agents/other"]);
  // with no error, neither another agent nor the page's own view state mounts it anew
  const before = mounts;
  await act(() => go("/agents/agents/third"));
  await act(() => go(`/agents/agents/third?view=${encodeURIComponent('{"q":"x"}')}`));
  expect([shown(), mounts]).toEqual(["/agents/third", before]);
});

test("the Dash draws before the mind has said who is signed in: the page at once, with the account not known, and the account when the mind answers", async () => {
  let answer: (who: object) => void = () => {};
  const whoami = vi.fn(() => new Promise<object>((resolve) => (answer = resolve)));
  await using dash = await draw("/who", [], { pages: withWho, principal: "ask", whoami });
  const { host } = dash;
  // the frame and the page are there, and nothing says who
  expect(headerBrandLink(host)?.getAttribute("href")).toBe("/");
  expect(host.querySelector("output")?.textContent).toBe("not known yet");
  expect(host.querySelector('[aria-label="Account"]')).toBeNull();
  await act(async () => answer({ principal: { actor: "/members/a", email: "jo@example.com" } }));
  expect(host.querySelector("output")?.textContent).toBe("jo@example.com");
  expect(host.querySelector('[aria-label="Account"]')?.textContent).toContain("jo@example.com");
  expect(whoami).toHaveBeenCalledTimes(1);
});

test("a page that already knows who is signed in is not asked, and a member with no address is known too", async () => {
  const whoami = vi.fn(async () => ({}));
  await using dash = await draw("/who", [], { pages: withWho, principal: null, whoami });
  expect(dash.host.querySelector("output")?.textContent).toBe("nobody the page can name");
  expect(whoami).not.toHaveBeenCalled();
});

test("a whoami that the mind refused on an open session is asked again by itself, and the account then arrives", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const whoami = vi
    .fn<() => Promise<object>>()
    .mockRejectedValueOnce(new Error("Durable Object is overloaded"))
    .mockResolvedValue({ principal: { actor: "/members/a", email: "jo@example.com" } });
  await using dash = await draw("/who", [], { pages: withWho, principal: "ask", whoami });
  await act(() => vi.advanceTimersByTimeAsync(0));
  expect(whoami).toHaveBeenCalledTimes(1);
  expect(dash.host.textContent).not.toContain("jo@example.com");
  // no new session and no reload: the ask goes again after its wait
  await act(() => vi.advanceTimersByTimeAsync(1_100));
  expect(whoami).toHaveBeenCalledTimes(2);
  await until(() => dash.host.textContent?.includes("jo@example.com"));
  vi.useRealTimers();
});

test("a whoami that was refused because no session opened is asked again when one opens", async () => {
  const session = fakeSession();
  const whoami = vi
    .fn<() => Promise<object>>()
    .mockRejectedValueOnce(new Error("Peer closed WebSocket: 1006"))
    .mockResolvedValue({ principal: { actor: "/members/a", email: "jo@example.com" } });
  await using dash = await draw("/who", [], {
    pages: withWho,
    principal: "ask",
    whoami,
    session,
  });
  expect(dash.host.querySelector("output")?.textContent).toBe("not known yet");
  expect(whoami).toHaveBeenCalledTimes(1);
  await act(async () => session.set({ epoch: 1, state: "open" }));
  expect(dash.host.querySelector("output")?.textContent).toBe("jo@example.com");
  expect(whoami).toHaveBeenCalledTimes(2);
});

test("the sidebar of a person who made no choice is as the page says (the rail of icons for false); the choice they made wins", async () => {
  {
    await using dash = await draw("/", [], { sidebarDefaultOpen: false });
    expect(dash.host.querySelector("[data-slot=sidebar]")?.getAttribute("data-state")).toBe(
      "collapsed",
    );
  }
  document.cookie = "sidebar_state=true; path=/";
  try {
    await using dash = await draw("/", [], { sidebarDefaultOpen: false });
    expect(dash.host.querySelector("[data-slot=sidebar]")?.getAttribute("data-state")).toBe(
      "expanded",
    );
  } finally {
    document.cookie = "sidebar_state=; path=/; max-age=0";
  }
});

test("while a page's part loads, its place holds quiet shapes and no words", async () => {
  await using dash = await draw("/slow", [], { pages: withWho });
  const place = dash.host.querySelector("[data-slot=dash-placeholder]");
  expect(Boolean(place)).toBe(true);
  expect(place?.textContent).toBe("");
  expect(dash.host.textContent).not.toContain("Loading the page…");
  // the sidebar is there meanwhile
  expect(headerBrandLink(dash.host)?.getAttribute("href")).toBe("/");
});

test("a page the URL does not name is the first page", async () => {
  await using dash = await draw("/nothing-here", []);
  expect(dash.host.querySelector("h1")?.textContent).toBe("iterate.example.com");
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
  expect(rows[0]?.querySelector("a")?.getAttribute("href")).toBe("/agents/agents/a");
  expect(linksNamed(dash.host, "View all")[0]?.getAttribute("href")).toBe("/agents");
  expect(linksNamed(dash.host, "Agents page")).toHaveLength(0);
  // agents sit above the foot group (any remaining page rows follow View all)
  const sidebarLinks = [...dash.host.querySelectorAll('[data-slot="sidebar-content"] a')];
  const firstAgent = sidebarLinks.findIndex((link) => link.closest("[data-agent-path]"));
  const viewAll = sidebarLinks.findIndex((link) => link.textContent?.includes("View all"));
  const analytics = sidebarLinks.findIndex((link) => link.textContent?.includes("Analytics"));
  expect(firstAgent).toBeGreaterThanOrEqual(0);
  expect(viewAll).toBeGreaterThan(firstAgent);
  expect(analytics).toBeGreaterThan(viewAll);
  // a click opens the agent view: the Agents page, with the path; its row is the current one
  await act(() => rows[1]!.querySelector("a")!.click());
  expect(location).toMatchObject({ pathname: "/agents/agents/t7", search: "" });
  expect(dash.host.textContent).toContain("agent view of /agents/t7");
  expect(
    [...dash.host.querySelectorAll("[data-agent-path] a")].map((row) =>
      row.hasAttribute("data-active"),
    ),
  ).toEqual([false, true, false, false, false, false]);
});

test("in the icon rail an agent row is its icon alone: its words hide by the sidebar's classes, and its tooltip says its title, its line and its path", async () => {
  // the sidebar as a person left it: collapsed to its icons
  document.cookie = "sidebar_state=false; path=/";
  const now = new Date().toISOString();
  const agents = {
    "/agents/flights": {
      createdAt: now,
      kind: "iterate",
      title: "Find a flight to Lisbon",
      status: "working",
      activity: "comparing fares",
      lastActivityAt: now,
    },
  };
  await using dash = await draw("/", [], { pages: withAgentPages, agents });
  document.cookie = "sidebar_state=; path=/; max-age=0";
  const { host } = dash;
  expect(host.querySelector('[data-collapsible="icon"]')).not.toBeNull();
  const link = host.querySelector<HTMLAnchorElement>('[data-agent-path="/agents/flights"] a')!;
  // the words are one span that the rail hides; the icon and its status dot stay
  const words = [...link.children].at(-1)!;
  expect(words).toMatchObject({ textContent: "Find a flight to Lisboncomparing fares" });
  expect(words.classList).toContain("group-data-[collapsible=icon]:hidden");
  // the link keeps its name where its words are not drawn
  expect(link.getAttribute("aria-label")).toBe("Find a flight to Lisbon");
  expect(link.querySelector("[data-agent-status]")).toMatchObject({ title: "working" });
  // the large row is the pages' square in the rail, its icon centred
  expect(link.classList).toContain("group-data-[collapsible=icon]:p-2!");
  expect(link.classList).not.toContain("group-data-[collapsible=icon]:p-0!");
  // focus opens its tooltip, as a hover does
  await act(() => link.focus());
  await until(() => document.querySelector("[data-agent-tooltip]"));
  expect(
    [...document.querySelector("[data-agent-tooltip]")!.children].map((line) => line.textContent),
  ).toEqual(["Find a flight to Lisbon", "comparing fares", "/agents/flights"]);
});

test("sidebar order is alert, New agent & pinned, agents (skipping pinned), then foot links and visible pages", async () => {
  const now = new Date().toISOString();
  await using dash = await draw("/", ["itx.secrets"], {
    mind: "order.example.com",
    contexts: [],
    pages: [
      pages[0]!,
      { ...pages[1]!, row: false as const },
      { id: "agents", name: "Agents", icon: BotIcon, component: () => <p>agents</p> },
      { id: "settings", name: "Settings", icon: SettingsIcon, component: DashSettings },
    ],
    pinned: [{ name: "Chief of staff", href: "/agents/agents/chief", icon: BotIcon }],
    foot: [
      {
        name: "Approvals",
        href: "https://order.example.com/secrets/approvals",
        icon: ShieldCheckIcon,
        count: "approvals",
      },
    ],
    accountLinks: [
      {
        name: "Your sessions",
        href: "https://order.example.com/sessions",
        icon: LogOutIcon,
      },
    ],
    agents: {
      "/agents/chief": {
        createdAt: now,
        kind: "iterate",
        title: "Chief of staff",
        lastActivityAt: now,
      },
      "/agents/other": {
        createdAt: now,
        kind: "iterate",
        title: "Other agent",
        lastActivityAt: now,
      },
    },
    approvalEvents: [
      {
        type: "events.iterate.com/approval/act-held",
        createdAt: now,
        payload: { digest: "d1", act: "email.send", summary: "Send mail" },
      },
      {
        type: "events.iterate.com/approval/act-held",
        createdAt: now,
        payload: { digest: "d2", act: "email.send", summary: "Send mail 2" },
      },
    ],
  });
  await act(async () => {
    askWaitingApprovals("order.example.com");
  });
  await until(() => dash.host.querySelector("[data-approvals-alert]"));
  // phone sidebar trigger carries the warning dot while requests wait
  expect(dash.host.querySelector("[data-sidebar-alert]")).not.toBeNull();
  // pinned agent is skipped from DashAgentsNav so it is not listed twice
  expect(
    [...dash.host.querySelectorAll("[data-agent-path]")].map((r) =>
      r.getAttribute("data-agent-path"),
    ),
  ).toEqual(["/agents/other"]);
  // row: false hides Analytics from the sidebar while keeping /analytics routable
  expect(linksNamed(dash.host, "Analytics")).toHaveLength(0);
  // exact order in sidebar content: alert -> New agent -> Chief of staff -> Other agent -> View all -> Approvals (with badge 2) -> Settings
  const alertEl = dash.host.querySelector("[data-approvals-alert]")!;
  expect(alertEl).toMatchObject({
    textContent: "2 requests wait",
    title: "2 requests wait for approval",
  });
  const navOrder = [...dash.host.querySelectorAll('[data-slot="sidebar-content"] a')].map((a) =>
    a.textContent?.trim(),
  );
  expect(navOrder).toEqual([
    "2 requests wait",
    "New agent",
    "Chief of staff",
    "Other agent/agents/other",
    "View all",
    "Approvals",
    "Settings",
  ]);
  const approvalsItem = linksNamed(dash.host, "Approvals")[0]!.closest(
    '[data-slot="sidebar-menu-item"]',
  );
  expect(approvalsItem?.querySelector('[data-slot="sidebar-menu-badge"]')?.textContent).toBe("2");
  // accountLinks appear in the account popover above Sign out
  const account = dash.host.querySelector<HTMLElement>('[aria-label="Account"]')!;
  await act(async () => {
    account.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
    account.click();
  });
  const menu = document.querySelector('[role="menu"]')!;
  expect(menu.textContent).toContain("Your sessions");
  expect(menu.textContent).toContain("Sign out");
  expect(menu.querySelector('a[href="https://order.example.com/sessions"]')).not.toBeNull();
  // row: false page is still routable directly and marks the Settings sidebar row active
  await act(() => go("/analytics"));
  expect(dash.host.textContent).toContain("the charts");
  expect(linksNamed(dash.host, "Settings")[0]!.hasAttribute("data-active")).toBe(true);
});

test("without a settings page, links draw as plain labelled fallback groups with approval counts; any settings id suppresses them", async () => {
  const now = new Date().toISOString();
  {
    await using dash = await draw("/", ["itx.secrets"], {
      mind: "fallback.example.com",
      contexts: [],
      approvalEvents: [
        {
          type: "events.iterate.com/approval/act-held",
          createdAt: now,
          payload: { digest: "f1", act: "email.send", summary: "Send mail" },
        },
      ],
    });
    await act(async () => {
      askWaitingApprovals("fallback.example.com");
    });
    await until(() => dash.host.querySelector("[data-approvals-alert]"));
    const labels = [...dash.host.querySelectorAll('[data-slot="sidebar-group-label"]')].map((el) =>
      el.textContent?.trim(),
    );
    expect(labels).toContain("Access");
    const approvalsItem = linksNamed(dash.host, "Approvals")[0]!.closest(
      '[data-slot="sidebar-menu-item"]',
    );
    expect(approvalsItem?.querySelector('[data-slot="sidebar-menu-badge"]')?.textContent).toBe("1");
  }
  {
    // tested by id `settings`, even when a mind replaces DashSettings with its own component
    await using dash = await draw("/", [], {
      pages: [
        ...pages,
        { id: "settings", name: "Settings", icon: SettingsIcon, component: () => <p>custom</p> },
      ],
    });
    expect(linksNamed(dash.host, "Approvals")).toHaveLength(0);
  }
});

test("DashSettings lists row: false pages and links groups with about, Off state, and waiting approvals", async () => {
  const now = new Date().toISOString();
  await using dash = await draw("/settings", ["itx.secrets"], {
    mind: "settings.example.com",
    contexts: [],
    pages: [
      pages[0]!,
      {
        id: "analytics",
        name: "Analytics",
        about: "The mind's telemetry.",
        icon: ChartLineIcon,
        serves: "telemetry",
        row: false,
        component: () => <p>the charts</p>,
      },
      { id: "settings", name: "Settings", icon: SettingsIcon, component: DashSettings },
    ],
    links: [
      {
        title: "Access",
        rows: [
          {
            name: "Approvals",
            about: "What waits for a passkey, and the rules.",
            href: "https://settings.example.com/secrets/approvals",
            icon: ShieldCheckIcon,
            count: "approvals",
          },
        ],
      },
      {
        title: "Apps",
        rows: [
          {
            name: "Docs",
            about: "The repos' files, written together.",
            href: "https://docs.example.com/",
            icon: BotIcon,
          },
        ],
      },
    ],
    approvalEvents: [
      {
        type: "events.iterate.com/approval/act-held",
        createdAt: now,
        payload: { digest: "d1", act: "email.send", summary: "Send mail" },
      },
    ],
  });
  await act(async () => {
    askWaitingApprovals("settings.example.com");
  });
  await until(() => dash.host.textContent?.includes("1 waits"));
  const main = dash.host.querySelector("main")!;
  expect(main.textContent).toContain("Settings");
  expect(main.textContent).toContain("These pages show what the mind holds. Each line opens one.");
  expect(main.textContent).toContain("This mind");
  expect(main.textContent).toContain("The mind's telemetry.");
  expect(main.textContent).toContain("Off");
  expect(main.textContent).toContain("Access (pages on settings.example.com)");
  expect(main.textContent).toContain("What waits for a passkey, and the rules.");
  expect(main.textContent).toContain("1 waits");
  expect(main.textContent).toContain("Apps");
  expect(main.textContent).toContain("The repos' files, written together.");
  // clicking a page in Settings navigates in place
  const analyticsLink = main.querySelector<HTMLAnchorElement>('a[href="/analytics"]')!;
  await act(() =>
    analyticsLink.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 })),
  );
  expect(location).toMatchObject({ pathname: "/analytics", search: "" });
  expect(dash.host.textContent).toContain("the charts");
});

test("a row the mind pins sits right under New agent, and an agent's view opens in place", async () => {
  await using dash = await draw("/", [], {
    pages: [...pages, { id: "agents", name: "Agents", icon: BotIcon, component: () => null }],
    pinned: [{ name: "Pinned helper", href: "/agents/agents/helper", icon: BotIcon }],
  });
  const names = [...dash.host.querySelectorAll('[data-slot="sidebar-content"] a')].map(
    (link) => link.textContent,
  );
  expect(names.slice(names.indexOf("New agent"), names.indexOf("New agent") + 4)).toEqual([
    "New agent",
    "Pinned helper",
    "View all",
    "Analytics",
  ]);
  const row = linksNamed(dash.host, "Pinned helper")[0]!;
  expect(row.getAttribute("href")).toBe("/agents/agents/helper");
  await act(() => row.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 })));
  expect(location).toMatchObject({ pathname: "/agents/agents/helper", search: "" });
});

test("New agent is never marked or boxed, and a pinned row is marked while its own agent or a subagent is open", async () => {
  await using dash = await draw("/", [], {
    pages: [
      ...pages,
      { id: "agents", name: "Agents", icon: BotIcon, component: () => <p>agents page</p> },
    ],
    pinned: [{ name: "Pinned helper", href: "/agents/agents/helper", icon: BotIcon }],
  });
  /** [is it marked as the current row, is it drawn as a box] of the sidebar row with this name */
  const look = (name: string) => {
    const row = linksNamed(dash.host, name)[0]!;
    return [row.hasAttribute("data-active"), /bg-background|shadow-\[/.test(row.className)];
  };
  const marked = () => ({ newAgent: look("New agent"), pinned: look("Pinned helper") });
  // home, the pinned agent's own view, a subagent under its path, another agent, and the overview
  expect(marked()).toEqual({ newAgent: [false, false], pinned: [false, false] });
  await act(() => go("/agents/agents/helper"));
  expect(marked()).toEqual({ newAgent: [false, false], pinned: [true, false] });
  await act(() => go("/agents/agents/helper/sub"));
  expect(marked()).toEqual({ newAgent: [false, false], pinned: [true, false] });
  await act(() => go("/agents/agents/other"));
  expect(marked()).toEqual({ newAgent: [false, false], pinned: [false, false] });
  await act(() => go("/agents"));
  expect(marked()).toEqual({ newAgent: [false, false], pinned: [false, false] });
});

test("Dash header shows mind name, logo, and hostname as one Home link, and account menu says Sign out without hostname", async () => {
  await using dash = await draw("/analytics", ["itx.telemetry"], {
    name: "iterate",
    logo: <span data-mind-logo>I</span>,
  });
  const { host } = dash;
  expect(host.querySelector('[aria-label="Switch mind"]')).toBeNull();
  const brand = headerBrandLink(host)!;
  expect(brand.getAttribute("href")).toBe("/");
  expect(brand.textContent).toContain("iterate");
  expect(brand.textContent).toContain("iterate.example.com");
  expect(brand.querySelector("[data-mind-logo]")?.textContent).toBe("I");
  // clicking the brand navigates Home in place
  await act(() => brand.click());
  expect(location).toMatchObject({ pathname: "/", search: "" });
  expect(host.querySelector("h1")?.textContent).toBe("iterate.example.com");

  // account popover says plain "Sign out" without repeating the hostname
  const account = host.querySelector<HTMLElement>('[aria-label="Account"]')!;
  await act(async () => {
    account.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
    account.click();
  });
  const menu = document.querySelector('[role="menu"]')!;
  expect(menu.textContent).toContain("Sign out");
  expect(menu.textContent).not.toContain("Sign out of iterate.example.com");
});

test("each page and each agent has its canonical address: deep link, click, Back, /home", async () => {
  try {
    function AgentShown() {
      const agent = usePageParam("agent");
      return <p>agent view of {agent || "none"}</p>;
    }
    const agents = { id: "agents", name: "Agents", icon: BotIcon, component: AgentShown };
    // a deep link, opened cold: an agent whose path holds an address
    await using dash = await draw("/agents/agents/canvas2/ada@example.com/notes.md", [], {
      pages: [...pages, agents],
      pinned: [{ name: "Pinned helper", href: "/agents/agents/helper", icon: BotIcon }],
      agents: { "/agents/t1": { createdAt: "2026-01-01T00:00:00.000Z", kind: "iterate" } },
    });
    const { host } = dash;
    const hrefOf = (name: string) => linksNamed(host, name)[0]?.getAttribute("href");
    expect(host.textContent).toContain("agent view of /agents/canvas2/ada@example.com/notes.md");
    // every link is a path from the root, so it leads to the same place from any page
    await until(() => host.querySelector("[data-agent-path] a"));
    expect({
      brand: headerBrandLink(host)?.getAttribute("href"),
      analytics: hrefOf("Analytics"),
      newAgent: hrefOf("New agent"),
      all: hrefOf("View all"),
      pinned: hrefOf("Pinned helper"),
      agent: host.querySelector("[data-agent-path] a")?.getAttribute("href"),
    }).toEqual({
      brand: "/",
      analytics: "/analytics",
      newAgent: "/agents",
      all: "/agents",
      pinned: "/agents/agents/helper",
      agent: "/agents/agents/t1",
    });
    // a click on a page's row, then on the pinned row, which is marked while its agent is open
    await act(() => linksNamed(host, "Analytics")[0]!.click());
    expect(location).toMatchObject({ pathname: "/analytics", search: "" });
    expect(host.textContent).toContain("the charts");
    await act(() => linksNamed(host, "Pinned helper")[0]!.click());
    expect(location).toMatchObject({ pathname: "/agents/agents/helper", search: "" });
    expect(host.textContent).toContain("agent view of /agents/helper");
    expect(linksNamed(host, "Pinned helper")[0]!.hasAttribute("data-active")).toBe(true);
    // Back is the page before
    await act(async () => {
      history.back();
      await new Promise((resolve) => addEventListener("popstate", resolve, { once: true }));
    });
    expect(location).toMatchObject({ pathname: "/analytics" });
    expect(host.textContent).toContain("the charts");
    // agents overview and agent with view state
    await act(() => go("/agents"));
    expect(location).toMatchObject({ pathname: "/agents", search: "" });
    expect(host.textContent).toContain("agent view of none");
    await act(() => go("/agents/agents/t1?view=%7B%22view%22:%22events%22%7D"));
    expect(location).toMatchObject({
      pathname: "/agents/agents/t1",
      search: "?view=%7B%22view%22:%22events%22%7D",
    });
    expect(host.textContent).toContain("agent view of /agents/t1");
    // the first page is the root; /home replaces to / (keeping any hash), while /home/sub stays
    await act(() => go("/home#top"));
    expect(location).toMatchObject({ pathname: "/", search: "", hash: "#top" });
    expect(host.querySelector("h1")?.textContent).toBe("iterate.example.com");
    await act(() => go("/home/sub"));
    expect(location).toMatchObject({ pathname: "/home/sub", search: "" });
    await act(() => headerBrandLink(host)!.click());
    expect(location).toMatchObject({ pathname: "/", search: "" });
    expect(host.querySelector("h1")?.textContent).toBe("iterate.example.com");
  } finally {
    history.replaceState(null, "", "/");
  }
});

test("the Contexts page shows the context whose path follows its id, a dot in it or not", async () => {
  // this test's itx cannot open the root: the page says so
  vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await using dash = await draw("/contexts/agents/a.b", [], {
      pages: withContexts,
      contexts: catalogRows,
    });
    await until(() => dash.opened.length);
    expect(dash).toMatchObject({ opened: ["/"] });
    expect(dash.host.textContent).toContain("/agents/a.b");
    expect(dash.host.textContent).not.toContain("Pick a context from the list");
  } finally {
    history.replaceState(null, "", "/");
  }
});

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

/** A part that never loads. */
const never = new Promise<never>(() => {});

/** The pages, with one that says who the Dash says is signed in, and one whose part never loads. */
const withWho: DashPage[] = [
  ...pages,
  {
    id: "who",
    name: "Who",
    icon: BotIcon,
    component: ({ principal }: DashPageProps) => (
      <output>
        {/* oxlint-disable-next-line iterate/simple-truthiness-check -- undefined is not known yet, null is a member the page cannot name */}
        {principal === undefined ? "not known yet" : principal?.email || "nobody the page can name"}
      </output>
    ),
  },
  {
    id: "slow",
    name: "Slow",
    icon: BotIcon,
    component: function Slow() {
      return use(never);
    },
  },
];

/** A session of a page's itx whose connection the test sets. */
function fakeSession() {
  let connection: ItxConnection = { epoch: 0, state: "opening" };
  const readers = new Set<() => void>();
  return {
    get: () => connection,
    subscribe(changed: () => void) {
      readers.add(changed);
      return () => readers.delete(changed);
    },
    watch: () => () => {},
    set(next: ItxConnection) {
      connection = next;
      for (const changed of readers) changed();
    },
  };
}

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
    mind = "iterate.example.com",
    name,
    logo,
    pages: drawn = pages,
    links: drawnLinks = links,
    contexts,
    agents,
    approvalEvents,
    principal = { actor: "/members/a", email: "a@example.com" },
    whoami,
    session,
    sidebarDefaultOpen,
    pinned,
    foot,
    accountLinks,
  }: {
    mind?: string;
    name?: string;
    logo?: ReactNode;
    pages?: DashPage[];
    links?: DashLinks[];
    pinned?: DashLink[];
    foot?: DashLink[];
    accountLinks?: DashLink[];
    contexts?: unknown[];
    agents?: Record<string, object>;
    approvalEvents?: unknown[];
    /** Who the page says is signed in; "ask": it does not say, and the Dash asks the mind. */
    principal?: Principal | null | "ask";
    whoami?: () => Promise<object>;
    session?: ReturnType<typeof fakeSession>;
    sidebarDefaultOpen?: boolean;
  } = {},
) {
  history.replaceState(null, "", url);
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.stubGlobal("fetch", async () =>
    Response.json({
      minds: [{ address: mind, lastUsedAt: 0 }],
      lastUsed: mind,
    }),
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
    ...(session && { [ITX_SESSION]: session }),
    whoami,
    // a platform with no catalog rejects; `contexts` is a mind's catalog
    contexts: {
      list: async ({ under }: { under?: string } = {}) => {
        if (!contexts) throw new Error("No such method: contexts.list");
        return under ? [] : contexts;
      },
    },
    // the catalog of the mind's agents on /agents: its live state's seed, and no change after
    cd: (path: string) => {
      if (path === "/approvals" && approvalEvents) {
        return {
          readEvents: async () => ({
            events: approvalEvents,
            scannedThroughOffset: approvalEvents.length,
            atHead: true,
          }),
          [Symbol.dispose]() {},
        };
      }
      opened.push(path);
      if (path !== "/agents" || !agents) return Promise.reject(new Error(`no context ${path}`));
      return Promise.resolve({
        invoke: async () => ({ rev: 1, state: { agents } }),
        subscribe: async () => ({ [Symbol.dispose]() {} }),
        [Symbol.dispose]() {},
      });
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
        name={name}
        logo={logo}
        itx={itx}
        mind={mind}
        principal={principal === "ask" ? undefined : principal}
        pages={drawn}
        links={drawnLinks}
        pinned={pinned}
        foot={foot}
        accountLinks={accountLinks}
        sidebarDefaultOpen={sidebarDefaultOpen}
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

function headerBrandLink(host: Element) {
  return host.querySelector<HTMLAnchorElement>('[data-slot="sidebar-header"] a');
}
