// @vitest-environment jsdom
// The Dash's agent pages: the home says what waits for the member in a place of its own (nothing,
// or the requests and the integrations that ask for them), New agent is a composer alone, and the
// agent view draws any path under one header row (the path, who can use the conversation where
// presence is on, and Chat | Events), with the agent's
// status at the feed's foot, and says the opener once into an empty chat.
import { act, Suspense, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { BotIcon } from "lucide-react";
import { DashAgents, DashHome } from "./dash-agents.tsx";
import { AppShell } from "#/components/app-shell.tsx";
import type { DashPage, DashPageProps } from "#/components/dash/dash.tsx";
import { agentRowsOf } from "#/lib/agent-summary.ts";
import { savedLogTails } from "#/lib/saved-log-tail.ts";

// jsdom lays nothing out; the composer's CodeMirror measures text ranges after each change
Object.assign(Range.prototype, {
  getClientRects: () => [],
  getBoundingClientRect: () => new DOMRect(),
});

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

test.for([
  { name: "the Dash knows who is signed in", known: true },
  {
    name: "the Dash does not know yet who is signed in, and the mind is asked first",
    known: false,
  },
])(
  "a first message on the home, when $name, starts the agent in that person's folder",
  async ({ known }) => {
    const { itx, born, asked } = mind({});
    history.replaceState(null, "", "/");
    await using page = await draw(DashHome, itx, { waiting: 0, account: known });
    const composer = await composerOf(page.host);
    // the words, as a paste puts them in the editor (jsdom has no DataTransfer)
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", {
      value: {
        files: [],
        items: [{ kind: "string", type: "text/plain", getAsFile: () => null }],
        getData: (format: string) => (format === "text/plain" ? "hello" : ""),
      },
    });
    await act(async () => composer!.dispatchEvent(paste));
    const send = page.host.querySelector<HTMLButtonElement>('button[title="Send message"]');
    await act(async () => send!.click());
    await act(() => vi.waitFor(() => expect(born).toHaveLength(1)));
    expect(born[0]).toMatch(/^\/agents\/people\/jo\/web\//);
    expect(asked()).toBe(known ? 0 : 1);
  },
);

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

test("an agent page shows who else is here, and in its header who can use the conversation, only where the mind's config turned presence on", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  history.replaceState(null, "", "/?agent=/agents/onboarding");
  {
    // the default: no line, no place in the header, nothing sent
    const { itx, sent, appended } = mind({});
    await using page = await draw(DashAgents, itx, { waiting: 0 });
    expect({ sent, appended }).toEqual({ sent: [], appended: [] });
    expect(page.host.querySelector("[data-slot=agent-presence]")?.outerHTML).toBeUndefined();
    expect(page.host.querySelector("[data-slot=agent-header-aside]")?.outerHTML).toBeUndefined();
  }
  {
    // alone: the line over the composer holds no words, and the header's place holds the plain
    // people button
    const { itx, sent, appended } = mind({});
    await using page = await draw(DashAgents, itx, { waiting: 0, presence: true });
    expect({ sent, appended }).toEqual({ sent: [], appended: [] });
    expect(page.host.querySelector("[data-slot=agent-presence]")?.textContent).toBe("");
    const access = await vi.waitFor(() => {
      const button = page.host.querySelector(
        '[data-page-header] [data-slot=agent-header-aside] button[title="Who can use this conversation"]',
      );
      if (!button) throw new Error("the header has no button yet");
      return button;
    });
    expect(access.getAttribute("data-others")).toBe("0");
  }
  // another member's page open on this agent's context: a face. The SDK does not say this page's
  // own row yet, so the page says no status of its own.
  const { itx, sent, appended } = mind({
    pages: {
      "/agents/onboarding": [
        { name: "b-page", principal: { actor: "/members/b", email: "b@example.com" } },
      ],
    },
  });
  await using page = await draw(DashAgents, itx, { waiting: 0, presence: true });
  await vi.waitFor(() =>
    expect(
      page.host
        .querySelector("[data-slot=agent-presence] [data-slot=avatar]")
        ?.getAttribute("aria-label"),
    ).toBe("b@example.com is here"),
  );
  expect(
    page.host.querySelector("[data-slot=agent-header-aside] button")?.getAttribute("data-others"),
  ).toBe("1");
  expect({ sent, appended }).toEqual({ sent: [], appended: [] });
});

test("the header's count of held events leaves out a page's presence status", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  history.replaceState(null, "", "/?agent=/agents/onboarding");
  const { itx } = mind({
    logs: {
      "/agents/onboarding": [
        {
          offset: 1,
          type: "events.iterate.com/agent/context-added",
          payload: { role: "user", content: "hello", actor: { type: "user" } },
        },
        {
          offset: 2,
          type: "presence/status",
          payload: { subscription: "b-page", away: false, typing: false },
          source: { origin: "/", principal: { actor: "/members/b", email: "b@example.com" } },
        },
      ],
    },
  });
  await using page = await draw(DashAgents, itx, { waiting: 0, presence: true });
  const events = [...page.host.querySelectorAll("[data-page-header] [role=tab]")].find((tab) =>
    tab.textContent?.startsWith("Events"),
  );
  expect(events?.textContent).toBe("Events1");
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

test("a message's image is signed once, however often the page draws the chat again", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  using _layout = laidOut();
  const path = "/agents/talk";
  const file = { contentType: "image/png", filename: "photo.png", path: `${path}/photo.png` };
  const { itx, signed } = mind({
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
    vi.waitFor(() => expect(page.host.querySelector('img[alt="photo.png"]')).not.toBe(null)),
  );
  await page.draw(agents);
  await page.draw(agents);
  expect(signed).toEqual([file.path]);
});

test("a message the signed-in member sent has no line under it that says who sent it; another member's has their short name", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  using _layout = laidOut();
  const path = "/agents/talk";
  const said = (offset: number, content: string, principal: { actor: string; email: string }) => ({
    offset,
    type: "events.iterate.com/agent/context-added",
    payload: { role: "user", actor: { type: "user" }, content },
    source: { principal },
  });
  const { itx } = mind({
    logs: {
      [path]: [
        said(1, "mine", { actor: "/members/a", email: "jo@example.com" }),
        said(2, "theirs", { actor: "/members/b", email: "bo@example.com" }),
      ],
    },
  });
  history.replaceState(null, "", `/?agent=${path}`);
  await using page = await draw(DashAgents, itx, { waiting: 0 });
  const lines = () =>
    [...page.host.querySelectorAll("[data-kind=user]")].map(
      (bubble) => bubble.querySelector("[data-said-by]")?.textContent ?? null,
    );
  await act(() => vi.waitFor(() => expect(lines()).toEqual([null, "bo"])));
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

test("an iterate agent's view drawn a second time shows the saved rows while the mind has not answered", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  using _layout = laidOut();
  const path = "/agents/saved";
  const { itx, hold } = mind({
    logs: {
      [path]: [
        {
          offset: 1,
          type: "events.iterate.com/agent/context-added",
          payload: { role: "user", content: "Words from the last visit" },
        },
      ],
    },
  });
  history.replaceState(null, "", `/?agent=${path}`);
  {
    await using first = await draw(DashAgents, itx, { waiting: 0 });
    expect(first.host.querySelector("[role=log]")?.textContent).toContain(
      "Words from the last visit",
    );
  }
  hold();
  await using again = await draw(DashAgents, itx, { waiting: 0 });
  expect(again.host.querySelector("[role=log]")?.textContent).toContain(
    "Words from the last visit",
  );
  expect(again.said.filter((text) => text.includes("Nothing said"))).toEqual([]);
  // and at no moment of the second draw did the page say that it reads the log: not before the
  // view was there (the kinds and the catalog were read behind a quiet page), not after
  expect(again.said.filter((text) => text.includes("Reading the log"))).toEqual([]);
});

test("the agent page while its view is not there says nothing of a read when saved rows of its log wait, and says it when none do", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  using _layout = laidOut();
  const path = "/agents/kept";
  const { itx } = mind({
    logs: {
      [path]: [
        {
          offset: 1,
          type: "events.iterate.com/agent/context-added",
          payload: { role: "user", content: "Words from the last visit" },
        },
      ],
    },
  });
  history.replaceState(null, "", `/?agent=${path}`);
  {
    // a first visit reads the log, and the page keeps its rows
    await using first = await draw(DashAgents, itx, { waiting: 0 });
    expect(first.host.querySelector("[role=log]")?.textContent).toContain(
      "Words from the last visit",
    );
  }
  {
    // again, and the catalog has not said the agent's kind yet: the wait is for the view, and the
    // rows are held, so the page does not say that it reads
    await using again = await draw(DashAgents, itx, { waiting: 0, agents: "unread" });
    expect(again.host.querySelectorAll("[role=tablist]")).toHaveLength(1);
    expect(again.host.querySelectorAll("[data-slot=log-reading]")).toHaveLength(0);
  }
  // another agent, of whose log nothing is held: the page says that it reads
  history.replaceState(null, "", "/?agent=/agents/never-seen");
  await using other = await draw(DashAgents, itx, { waiting: 0, agents: "unread" });
  expect(other.host.querySelectorAll("[data-slot=log-reading]")).toHaveLength(1);
});

test("the opener is not appended while the chat's rows are a saved copy, only when the mind's log says it is empty", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const path = "/agents/opened";
  const { itx, appended, hold, release } = mind({
    logs: {
      // nothing said: a system note is context, not a start
      [path]: [
        {
          offset: 1,
          type: "events.iterate.com/agent/context-added",
          payload: { role: "system", content: "You are helpful." },
        },
      ],
    },
  });
  history.replaceState(null, "", `/?agent=${path}`);
  {
    await using _first = await draw(DashAgents, itx, { waiting: 0, openers: {} });
  }
  hold();
  await using again = await draw(DashAgents, itx, {
    waiting: 0,
    openers: { [path]: "Begin with step 1." },
  });
  expect(appended).toEqual([]);
  release();
  await act(() => vi.waitFor(() => expect(appended).toHaveLength(1)));
  expect(again.host.textContent).toContain(path);
});

test("an iterate agent drawn a second time, before the catalog and the kinds answer, is its chat with the saved rows at once", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  using _layout = laidOut();
  const path = "/agents/remembered";
  const logs = { [path]: [words(1, "Words from the last visit")] };
  history.replaceState(null, "", `/?agent=${path}`);
  {
    await using _first = await draw(DashAgents, mind({ logs }).itx, { waiting: 0 });
  }
  const second = mind({ logs });
  second.holdKinds();
  second.hold();
  await using again = await draw(DashAgents, second.itx, { waiting: 0, agents: "unread" });
  expect(again.host.querySelector("[role=log]")?.textContent).toContain(
    "Words from the last visit",
  );
  // no loading state at any moment: the view was there before the mind said anything
  expect(again.host.querySelectorAll("[data-slot=log-reading]")).toHaveLength(0);
  expect(again.said.filter((text) => text.includes("Reading"))).toEqual([]);
  second.release();
  second.releaseKinds();
});

test("an agent of a kind with a file, drawn a second time, has its frame before the kinds answer, and the same file keeps that frame", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const path = "/agents/claude-same";
  await rememberKindView(path, "export default {};");
  const second = mind({ kinds: { claude: "agent-kinds/claude.ts" } });
  second.holdKinds();
  await using again = await draw(DashAgents, second.itx, { waiting: 0, agents: "unread" });
  const frame = again.host.querySelector("iframe");
  expect(frame).not.toBe(null);
  second.releaseKinds();
  await again.draw(claudeRows(path));
  // the same element: the frame's document is not loaded again
  expect(again.host.querySelector("iframe")).toBe(frame);
});

test("when the kinds answer with another source for the remembered file, the frame mounts again and the store keeps the new source", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const path = "/agents/claude-changed";
  await rememberKindView(path, "export default { old: true };");
  const second = mind({ kinds: { claude: "agent-kinds/claude.ts" }, source: "export default {};" });
  second.holdKinds();
  await using again = await draw(DashAgents, second.itx, { waiting: 0, agents: "unread" });
  const frame = again.host.querySelector("iframe");
  expect(frame).not.toBe(null);
  second.releaseKinds();
  await again.draw(claudeRows(path));
  const now = again.host.querySelector("iframe");
  expect(now).not.toBe(null);
  expect(now).not.toBe(frame);
  expect(savedLogTails(member).peek(path)).toMatchObject({
    view: { kind: "claude", file: { name: "agent-kinds/claude.ts", source: "export default {};" } },
  });
});

test("when the catalog says another kind than the remembered one, the view changes to that kind's", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const path = "/agents/claude-now-iterate";
  await rememberKindView(path, "export default {};");
  const { itx } = mind({ kinds: { claude: "agent-kinds/claude.ts" } });
  await using again = await draw(DashAgents, itx, { waiting: 0, agents: "unread" });
  expect(again.host.querySelector("iframe")).not.toBe(null);
  await again.draw(agentRowsOf({ agents: { [path]: { createdAt: now, kind: "iterate" } } }));
  expect(again.host.querySelector("iframe")).toBe(null);
  expect(again.host.querySelector("[role=log]")).not.toBe(null);
});

test("another member's remembered view is never drawn: the page waits for the kinds and the catalog as on a first visit", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const path = "/agents/claude-of-a";
  await rememberKindView(path, "export default {};");
  const second = mind({ kinds: { claude: "agent-kinds/claude.ts" } });
  second.holdKinds();
  await using other = await draw(DashAgents, second.itx, {
    waiting: 0,
    agents: "unread",
    actor: "/members/b",
  });
  expect(other.host.querySelector("iframe")).toBe(null);
  expect(other.host.querySelectorAll("[data-slot=log-reading]")).toHaveLength(1);
  second.releaseKinds();
  await other.draw(claudeRows(path));
  expect(other.host.querySelector("iframe")).not.toBe(null);
});

test("the opener is not appended from a remembered view over a saved copy, only once the mind's log says it is empty", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const path = "/agents/opened-again";
  const logs = {
    [path]: [
      {
        offset: 1,
        type: "events.iterate.com/agent/context-added",
        payload: { role: "system", content: "You are helpful." },
      },
    ],
  };
  history.replaceState(null, "", `/?agent=${path}`);
  {
    await using _first = await draw(DashAgents, mind({ logs }).itx, { waiting: 0, openers: {} });
  }
  const second = mind({ logs });
  second.hold();
  second.holdKinds();
  await using again = await draw(DashAgents, second.itx, {
    waiting: 0,
    agents: "unread",
    openers: { [path]: "Begin with step 1." },
  });
  // the remembered view is drawn, over the saved copy
  expect(again.host.querySelector("[role=log]")).not.toBe(null);
  expect(second).toMatchObject({ appended: [] });
  second.release();
  await act(() => vi.waitFor(() => expect(second.appended).toHaveLength(1)));
  second.releaseKinds();
});

/** A mind whose logs are empty but for `logs`: what the page appends to a log is kept in
 *  `appended`, and the ephemeral events it sends (its `presence/status`) in `sent`. `pages`: the
 *  pages other members hold open on a context, by path, as its subscription rows and lent stubs.
 *  `hold()` keeps every read of a log unanswered until `release()`, and `holdKinds()` the read of
 *  the kinds until `releaseKinds()`. `kinds`: each kind's file in the config repo, by kind, each
 *  with `source`. Its root has `files`, and a context has none: only an iterate agent's context
 *  links to the root, and the page must not count on it. */
function mind({
  serves = [],
  integrations,
  kinds,
  unreadable = false,
  source = "export default {};",
  logs = {},
  pages = {},
}: {
  serves?: string[];
  integrations?: object;
  kinds?: Record<string, string>;
  /** the config repo refuses each read of a file, on a connection that is up */
  unreadable?: boolean;
  /** the source of every kind's file */
  source?: string;
  logs?: Record<string, { offset: number; type: string; payload: object; source?: object }[]>;
  pages?: Record<string, { name: string; principal: { actor: string; email: string } }[]>;
}) {
  const appended: { path: string; events: unknown[] }[] = [];
  const sent: { path: string; type: string }[] = [];
  /** the path of each file whose URL the page asked the mind to sign */
  const signed: string[] = [];
  /** the path of each agent the page started */
  const born: string[] = [];
  let reads = 0;
  let gate = Promise.resolve();
  let release = () => {};
  let kindsGate = Promise.resolve();
  let releaseKinds = () => {};
  let asked = 0;
  const contextOf = (path: string) => ({
    readEvents: async (after = 0) => {
      await gate;
      const held = (logs[path] || []).map((event) => ({ ...event, path, createdAt: now }));
      return {
        events: held.filter((event) => event.offset > after),
        atHead: true,
        scannedThroughOffset: held.at(-1)?.offset || 0,
      };
    },
    subscribe: async () => ({ [Symbol.dispose]() {} }),
    subscriptions: {
      list: async () =>
        (pages[path] || []).map(({ name, principal }) => ({
          name,
          target: `itx.builtins.rpcStubs.get('subscription:${name}')`,
          consumes: ["*", "presence/status"],
          configuredAtOffset: 1,
          heldBy: { principal, via: { appPage: "dash" } },
        })),
    },
    rpcStubs: { list: async () => (pages[path] || []).map(({ name }) => `subscription:${name}`) },
    invoke: async () => ({ rev: 1, state: path === "/integrations" ? integrations : {} }),
    append: async (...events: { type: string; ephemeral?: boolean }[]) => {
      // an ephemeral event is never in a log
      for (const event of events) if (event.ephemeral) sent.push({ path, type: event.type });
      const durable = events.filter((event) => !event.ephemeral);
      if (durable.length > 0) appended.push({ path, events: durable });
    },
    [Symbol.dispose]() {},
  });
  const itx = {
    kv: {
      get: async (key: string) => {
        await kindsGate;
        return key === "agent-kinds" && kinds ? JSON.stringify(kinds) : null;
      },
    },
    repos: {
      get: () => ({
        readFile: async () => {
          reads += 1;
          if (unreadable) throw new Error("no such file");
          return kinds ? source : null;
        },
      }),
    },
    rewriteRules: { get: async (root: string) => (serves.includes(root) ? { target: "x" } : null) },
    whoami: async () => {
      asked += 1;
      return { principal: { actor: "/members/a", email: "jo@example.com" } };
    },
    agents: {
      create: async (path: string) => void born.push(path),
      get: () => ({ message: async () => {}, [Symbol.dispose]() {} }),
    },
    cd: async (path: string) => contextOf(path),
    files: {
      get: (path: string) => ({
        url: async () => {
          signed.push(path);
          return { url: `https://files.example.com${path}` };
        },
        [Symbol.dispose]() {},
      }),
    },
  } as unknown as DashPageProps["itx"];
  return {
    itx,
    appended,
    sent,
    signed,
    born,
    reads: () => reads,
    asked: () => asked,
    hold: () => {
      gate = new Promise((resolve) => (release = resolve));
    },
    release: () => release(),
    holdKinds: () => {
      kindsGate = new Promise((resolve) => (releaseKinds = resolve));
    },
    releaseKinds: () => releaseKinds(),
  };
}

/** The member every page signs in as, unless a test says another. */
const member = { mind: "iterate.example.com", actor: "/members/a" };

/** The catalog with one Claude agent at `path`. */
function claudeRows(path: string) {
  return agentRowsOf({ agents: { [path]: { createdAt: now, kind: "claude" } } });
}

/** Something a person said in a chat, at `offset`. */
function words(offset: number, content: string) {
  return {
    offset,
    type: "events.iterate.com/agent/context-added",
    payload: { role: "user", content },
  };
}

/** A first visit to the Claude agent at `path`, whose kind's file has `source`: the page works out
 *  its view and keeps it. jsdom loads no frame, so the frame's read never starts and saves no
 *  rows: the rows it would have shown are saved here. */
async function rememberKindView(path: string, source: string) {
  history.replaceState(null, "", `/?agent=${path}`);
  const { itx } = mind({ kinds: { claude: "agent-kinds/claude.ts" }, source });
  {
    await using first = await draw(DashAgents, itx, { waiting: 0, agents: claudeRows(path) });
    expect(first.host.querySelector("iframe")).not.toBe(null);
  }
  savedLogTails(member).save(path, [{ ...words(1, "Hello"), createdAt: now }], true);
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
    presence,
    agents: first = agents,
    account = true,
    actor = "/members/a",
  }: {
    /** How many requests wait; undefined: the count is not known yet. */
    waiting: number | undefined;
    /** false: the Dash has not heard yet who is signed in */
    account?: boolean;
    /** the member signed in */
    actor?: string;
    openers?: Record<string, string>;
    /** The Agents page's `presence`: a member's open agent page shows who else is here. */
    presence?: boolean;
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
  const pages = [
    row("home"),
    { ...row("agents"), openers, presence },
    row("contexts"),
    row("integrations"),
  ];
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
          mind="iterate.example.com"
          mindHref={() => "./"}
          account={null}
          locationKey="/"
        >
          <Suspense fallback="Loading the page…">
            <Page
              itx={itx}
              mind="iterate.example.com"
              principal={account ? { actor, email: "jo@example.com" } : undefined}
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
