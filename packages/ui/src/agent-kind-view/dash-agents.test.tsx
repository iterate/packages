// @vitest-environment jsdom
// The Dash's agent pages: the home says what waits for the member in a place of its own (nothing,
// or the requests and the integrations that ask for them), New agent is a composer alone, and the
// agent view draws any path under one header row (the path, the stack of who is here and can use
// the conversation where presence is on, and Chat | Events), with the agent's
// status at the feed's foot, and says the opener once into an empty chat. Where the Agents page
// turns calls on, the header has the call's controls and the faces say who is in the call.
import { act, Suspense, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { BotIcon } from "lucide-react";
import { codedError } from "iterate/lib";
import { DashAgents, DashHome } from "./dash-agents.tsx";
import { AgentCall } from "./dash-call.tsx";
import { AppShell } from "#/components/app-shell.tsx";
import type { DashPage, DashPageProps } from "#/components/dash/dash.tsx";
import { agentRowsOf } from "#/lib/agent-summary.ts";
import { createCall, useCall, type CallContext } from "#/lib/call-engine.ts";
import { CallLive, viewOf } from "#/lib/call-rules.ts";
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
  ).toBe("/agents/agents/onboarding");
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
    ["SlackConnect a workspace", "/integrations"],
    ["GitHub: acmeThe app was removed", "/integrations"],
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
  history.replaceState(null, "", "/agents/agents/onboarding");
  await using page = await draw(DashAgents, itx, {
    waiting: 0,
    openers: { "/agents/onboarding": "Begin with step 1." },
  });
  expect(page.host.textContent).toContain("/agents/onboarding");
  expect(page.host.textContent).not.toContain("Raw view");
  // the opener goes once the whole log is read, which may end after the page drew: the wait is
  // outside act, which would hold the render that appends it until the wait ends
  await vi.waitFor(
    () =>
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
      ]),
    { timeout: 5_000 },
  );
  // a path that is no agent's draws as well, and an opener for another path says nothing
  history.replaceState(null, "", "/agents/secrets/slack");
  await using other = await draw(DashAgents, itx, { waiting: 0, openers: {} });
  expect(other.host.textContent).toContain("/secrets/slack");
  expect(appended).toHaveLength(1);
});

test("an agent page's header shows the stack of who is here, which opens who can use the conversation, only where the mind's config turned presence on", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  history.replaceState(null, "", "/agents/agents/onboarding");
  {
    // the default: no typing status, no place in the header, nothing sent
    const { itx, sent, appended } = mind({});
    await using page = await draw(DashAgents, itx, { waiting: 0 });
    expect({ sent, appended }).toEqual({ sent: [], appended: [] });
    expect(page.host.querySelector("[data-slot=agent-presence]")?.outerHTML).toBeUndefined();
    expect(page.host.querySelector("[data-slot=agent-header-aside]")?.outerHTML).toBeUndefined();
  }
  {
    // alone: the typing status over the composer holds no words, and the header's place holds
    // the button with one plain circle, as the page does not know its own row yet
    const { itx, sent, appended } = mind({});
    await using page = await draw(DashAgents, itx, { waiting: 0, presence: true });
    expect({ sent, appended }).toEqual({ sent: [], appended: [] });
    expect(page.host.querySelector("[data-slot=agent-presence]")?.textContent).toBe("");
    const access = await vi.waitFor(() => {
      const button = page.host.querySelector(
        "[data-page-header] [data-slot=agent-header-aside] button[data-conversation-access]",
      );
      if (!button) throw new Error("the header has no button yet");
      return button;
    });
    expect([
      access.getAttribute("aria-label"),
      access.getAttribute("data-here"),
      access.querySelectorAll("[data-viewer-unknown]").length,
    ]).toEqual(["Who can use this conversation", "0", 1]);
  }
  // another member's page open on this agent's context: a face in the header's stack, none over
  // the composer. The SDK does not say this page's own row yet, so the page says no status of its
  // own.
  const { itx, sent, appended } = mind({
    pages: {
      "/agents/onboarding": [
        { name: "b-page", principal: { actor: "/members/b", email: "b@example.com" } },
      ],
    },
  });
  await using page = await draw(DashAgents, itx, { waiting: 0, presence: true });
  const access = () =>
    page.host.querySelector("[data-slot=agent-header-aside] button[data-conversation-access]");
  await vi.waitFor(() =>
    expect(access()?.getAttribute("aria-label")).toBe(
      "Who can use this conversation. Here now: b@example.com.",
    ),
  );
  expect([
    [...(access()?.querySelectorAll("[data-slot=avatar]") || [])].map((face) => face.textContent),
    page.host.querySelector("[data-slot=agent-presence] [data-slot=avatar]")?.outerHTML,
  ]).toEqual([["B", ""], undefined]);
  expect({ sent, appended }).toEqual({ sent: [], appended: [] });
});

test("the header's count of held events leaves out a page's presence status", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  history.replaceState(null, "", "/agents/agents/onboarding");
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
    history.replaceState(null, "", `/agents${path}`);
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
  history.replaceState(null, "", "/agents/agents/onboarding");
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
  history.replaceState(null, "", `/agents${path}`);
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
  history.replaceState(null, "", `/agents${path}`);
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
  history.replaceState(null, "", `/agents${path}`);
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
  history.replaceState(null, "", "/agents/agents/session");
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
  history.replaceState(null, "", "/agents/agents/session");
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
  history.replaceState(null, "", "/agents/agents/onboarding");
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
  history.replaceState(null, "", "/agents");
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
    [DashAgents, "/agents"],
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
  history.replaceState(null, "", `/agents${path}`);
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
  history.replaceState(null, "", `/agents${path}`);
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
  history.replaceState(null, "", "/agents/agents/never-seen");
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
  history.replaceState(null, "", `/agents${path}`);
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
  history.replaceState(null, "", `/agents${path}`);
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
  history.replaceState(null, "", `/agents${path}`);
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

test("with the Agents page's `call` off, an agent page has no call: no place, no button, no tiles, nothing turned on", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  history.replaceState(null, "", "/agents/agents/onboarding");
  const { itx, invoked } = mind({ row: "a-page" });
  await using page = await draw(DashAgents, itx, { waiting: 0, presence: true });
  expect({
    place: page.host.querySelector("[data-slot=agent-header-call]")?.outerHTML,
    start: page.host.textContent?.includes("Start a call"),
    tiles: page.host.querySelector("[data-slot=agent-call-tiles]")?.outerHTML,
    facet: invoked.filter((one) => Array.isArray(one.call)),
  }).toEqual({ place: undefined, start: false, tiles: undefined, facet: [] });
});

test("with `call` on and no call on the agent: one Start a call, whose press turns the call on once, then joins", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  using _media = browserMedia();
  history.replaceState(null, "", "/agents/agents/onboarding");
  const { itx, invoked, steps } = mind({ row: "a-page" });
  const enable = vi.fn(async () => void steps.push("enable"));
  await using page = await draw(DashAgents, itx, { waiting: 0, call: { enable } });
  const place = page.host.querySelector("[data-page-header] [data-slot=agent-header-call]");
  const start = await act(() => vi.waitFor(() => buttonOf(place, "Start a call")));
  expect(buttonsOf(page.host).filter((one) => one === "Start a call")).toHaveLength(1);
  // no call facet: its live state is never asked for, so no entry of it fails
  expect(invoked.filter((one) => String(one.call).includes("'call'"))).toEqual([]);
  await act(async () => start.click());
  await act(() => vi.waitFor(() => expect(steps.slice(0, 2)).toEqual(["enable", "join"])));
  expect(enable).toHaveBeenCalledExactlyOnceWith(itx, "/agents/onboarding");
});

test("`call=join` on an agent with no call: the page turns the call on and joins listening only, once, and the key leaves the address", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  using media = browserMedia();
  history.replaceState(null, "", "/agents/agents/onboarding?call=join");
  const { itx, steps } = mind({ row: "a-page" });
  const enable = vi.fn(async () => void steps.push("enable"));
  await using page = await draw(DashAgents, itx, { waiting: 0, call: { enable } });
  await act(() => vi.waitFor(() => expect(steps.slice(0, 2)).toEqual(["enable", "join"])));
  expect(enable).toHaveBeenCalledOnce();
  expect(new URLSearchParams(location.search).get("call")).toBe(null);
  expect(location).toMatchObject({ pathname: "/agents/agents/onboarding" });
  const place = page.host.querySelector("[data-slot=agent-header-call]");
  await act(() => vi.waitFor(() => buttonOf(place, "Unmute")));
  expect(capturedNothing(media)).toEqual({ opened: [], tracksSent: [] });
});

test("`call=join` never opens the microphone: the page joins a call that is on muted, says so, and the person's Unmute opens it", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  using media = browserMedia();
  history.replaceState(null, "", "/agents/agents/onboarding?call=join");
  const { itx, steps } = mind({
    row: "a-page",
    pages: { "/agents/onboarding": [{ name: "b-page", principal: memberB }] },
    facets: { "/agents/onboarding": { call: callLive({ "b-page": ["mic"] }) } },
  });
  const enable = vi.fn(async () => {});
  await using page = await draw(DashAgents, itx, { waiting: 0, call: { enable } });
  await act(() => vi.waitFor(() => expect(steps).toContain("join")));
  expect(enable).not.toHaveBeenCalled();
  expect(new URLSearchParams(location.search).get("call")).toBe(null);
  const place = page.host.querySelector("[data-slot=agent-header-call]");
  const unmute = await act(() => vi.waitFor(() => buttonOf(place, "Unmute")));
  await act(() =>
    vi.waitFor(() =>
      // the call's notices are the tiles' words, over the feed
      expect(page.host.querySelector("[data-slot=agent-call-tiles]")?.textContent).toContain(
        "You joined from a link, muted: no one hears you until you press Unmute.",
      ),
    ),
  );
  // the camera and the screen are off, and nothing was captured or sent
  expect(buttonOf(place, "Share video")).toBeTruthy();
  expect(buttonOf(place, "Share the screen")).toBeTruthy();
  expect(capturedNothing(media)).toEqual({ opened: [], tracksSent: [] });
  // the person's own press: now the microphone opens, is published, and is live
  await act(async () => unmute.click());
  await act(() => vi.waitFor(() => buttonOf(place, "Mute")));
  expect(capturedNothing(media)).toEqual({ opened: ["audio"], tracksSent: ["a track"] });
});

test("a start that fails says why in words, and Start a call can be pressed again", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  history.replaceState(null, "", "/agents/agents/onboarding");
  const { itx, steps } = mind({ row: "a-page" });
  await using page = await draw(DashAgents, itx, {
    waiting: 0,
    call: {
      enable: async () => {
        throw new Error("the call's module is not in this mind's config");
      },
    },
  });
  const place = page.host.querySelector("[data-slot=agent-header-call]");
  await act(async () => (await vi.waitFor(() => buttonOf(place, "Start a call"))).click());
  await act(() =>
    vi.waitFor(() =>
      expect(place?.querySelector("[role=alert]")?.textContent).toBe(
        "The call could not start: the call's module is not in this mind's config",
      ),
    ),
  );
  expect(buttonOf(place, "Start a call")).toMatchObject({ disabled: false });
  expect(steps).toEqual([]);
});

test("a call another member is in: Join in the header, a ring on their face, and the card says so", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  history.replaceState(null, "", "/agents/agents/onboarding");
  const { itx } = mind({
    row: "a-page",
    pages: { "/agents/onboarding": [{ name: "b-page", principal: memberB }] },
    facets: { "/agents/onboarding": { call: callLive({ "b-page": ["mic", "camera"] }) } },
  });
  await using page = await draw(DashAgents, itx, {
    waiting: 0,
    presence: true,
    call: { enable: async () => {} },
  });
  const place = page.host.querySelector("[data-slot=agent-header-call]");
  await act(() => vi.waitFor(() => buttonOf(place, "Join")));
  expect(page.host.textContent).not.toContain("Start a call");
  const access = page.host.querySelector<HTMLElement>("button[data-conversation-access]");
  await act(() =>
    vi.waitFor(() =>
      expect(
        [...(access?.querySelectorAll("[data-slot=avatar]") || [])].map((face) => [
          face.textContent,
          face.classList.contains("outline-success"),
        ]),
      ).toEqual([
        ["B", true],
        ["", false],
      ]),
    ),
  );
  await act(async () => access!.click());
  await act(() =>
    vi.waitFor(() =>
      expect(document.querySelector("[data-shared-here]")?.textContent).toBe(
        "Here now: b@example.com (in the call, camera)",
      ),
    ),
  );
});

test("in the call: the bar's buttons and Leave in the same place, the voice agent's too, and the tiles over the feed", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  using _media = browserMedia();
  history.replaceState(null, "", "/agents/agents/onboarding");
  const { itx } = mind({
    row: "a-page",
    pages: { "/agents/onboarding": [{ name: "b-page", principal: memberB }] },
    facets: {
      "/agents/onboarding": { call: callLive({ "a-page": ["mic"], "b-page": ["mic"] }) },
    },
  });
  await using page = await draw(DashAgents, itx, { waiting: 0, call: { enable: async () => {} } });
  const place = page.host.querySelector("[data-slot=agent-header-call]");
  const before = place?.getAttribute("class");
  await act(async () => (await vi.waitFor(() => buttonOf(place, "Join"))).click());
  // a member's bar: the voice agent's button is there (a guest's bar has none: call-bar.test.tsx)
  await act(() =>
    vi.waitFor(() =>
      expect([...(place?.querySelectorAll("button") || [])].map((one) => one.title)).toEqual([
        "Mute",
        "Share video",
        "Share the screen",
        "Devices",
        "Add a voice agent",
        "Leave the call",
      ]),
    ),
  );
  // the place is the one the header drew first, as it was: the faces and the tabs did not move
  expect(page.host.querySelector("[data-slot=agent-header-call]")).toBe(place);
  expect(place?.getAttribute("class")).toBe(before);
  // the tiles stand over the feed, out of the header; the path each connection takes is read at
  // the engine's next look
  const tiles = page.host.querySelector("[data-slot=agent-call-tiles]");
  expect([
    tiles?.closest("[data-page-header]"),
    tiles?.querySelector("[data-slot=call-tiles]")?.textContent,
  ]).toEqual([null, expect.stringContaining("Connecting…")]);
});

test("a start whose call's live state comes before the join ends: Starting… alone, never Join, then the joined bar; one join", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  using _media = browserMedia();
  const facet = callFacet();
  const joining = facet.hold("join");
  await using page = await drawCall(facet, async () => {
    // the call is on: its row and its live state come before `enable` answers
    page.update({ facetOn: true, live: callLive({}) });
  });
  await act(async () => buttonOf(page.place, "Start a call").click());
  await act(() => vi.waitFor(() => expect(facet).toMatchObject({ steps: ["join"] })));
  expect(buttonsOf(page.place)).toEqual(["Starting…"]);
  await act(async () => joining.release());
  await act(() => vi.waitFor(() => buttonOf(page.place, "Leave the call")));
  expect(page.seen.filter((buttons) => buttons.includes("Join the call"))).toEqual([]);
  expect(facet.steps.filter((step) => step === "join")).toEqual(["join"]);
});

test("a start whose call's live state comes after the join ended: the joined bar at once, never an empty header", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  using _media = browserMedia();
  const facet = callFacet();
  await using page = await drawCall(facet, async () => page.update({ facetOn: true }));
  await act(async () => buttonOf(page.place, "Start a call").click());
  await act(() => vi.waitFor(() => buttonOf(page.place, "Leave the call")));
  await act(async () => page.update({ facetOn: true, live: callLive({ "a-page": ["mic"] }) }));
  expect(buttonOf(page.place, "Leave the call")).toMatchObject({
    disabled: false,
  });
  expect(page.seen.filter((buttons) => buttons.length === 0)).toEqual([]);
});

test("Leave wins against the live state: one that says 'not in the call' while the leave is on its way joins nothing again", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  using _media = browserMedia();
  let now = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const facet = callFacet();
  await using page = await drawCall(facet, async () => page.update({ facetOn: true }));
  await act(async () => buttonOf(page.place, "Start a call").click());
  await act(async () => page.update({ facetOn: true, live: callLive({ "a-page": ["mic"] }) }));
  await act(() => vi.waitFor(() => buttonOf(page.place, "Leave the call")));
  now += 6_000;
  const leaving = facet.hold("leave");
  await act(async () => buttonOf(page.place, "Leave the call").click());
  // the call already took the page out: its live state says so before the leave answers
  await act(async () => page.update({ facetOn: true, live: callLive({}) }));
  await act(async () => leaving.release());
  await act(() => vi.waitFor(() => buttonOf(page.place, "Join the call")));
  now += 10_000;
  await act(async () => page.update({ facetOn: true, live: callLive({ "b-page": ["mic"] }) }));
  expect(facet.steps.filter((step) => step === "join")).toEqual(["join"]);
  expect(buttonOf(page.place, "Join the call")).toBeTruthy();
});

test("no live state says nothing of who is in the call: a joined page does not join again for it", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  using _media = browserMedia();
  let now = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const facet = callFacet();
  await using page = await drawCall(facet, async () => page.update({ facetOn: true }));
  await act(async () => buttonOf(page.place, "Start a call").click());
  await act(async () => page.update({ facetOn: true, live: callLive({ "a-page": ["mic"] }) }));
  await act(() => vi.waitFor(() => buttonOf(page.place, "Leave the call")));
  now += 6_000;
  // the call's row is there, its live state is no more (a facet that restarts, a lost read)
  await act(async () => page.update({ facetOn: true }));
  expect(facet.steps.filter((step) => step === "join")).toEqual(["join"]);
  expect(buttonOf(page.place, "Leave the call")).toBeTruthy();
});

test("a Leave while the microphone is published stops the publish: no connection and no microphone stay open", async () => {
  using media = browserMedia();
  const facet = callFacet();
  const call = engineOn(facet);
  const publishing = facet.hold("signal");
  const joining = call.join();
  await vi.waitFor(() => expect(facet).toMatchObject({ steps: ["join", "signal"] }));
  await call.leave();
  publishing.release();
  await joining;
  expect({
    joined: call.ui.joined,
    open: media.connections.filter((one) => !one.closed).length,
    mic: media.mic.readyState,
    steps: facet.steps,
  }).toEqual({ joined: false, open: 0, mic: "ended", steps: ["join", "signal", "leave"] });
});

test("a dispose while the page joins again keeps it out: no join, no connection, no microphone", async () => {
  using media = browserMedia();
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    const facet = callFacet();
    const call = engineOn(facet);
    await call.join();
    const resetting = facet.hold("signal");
    vi.setSystemTime(Date.now() + 6_000);
    const syncing = call.sync(viewOf(CallLive.parse(callLive({})), "a-page"));
    // the publish, then both resets
    await vi.waitFor(() =>
      expect(facet).toMatchObject({ steps: ["join", "signal", "signal", "signal"] }),
    );
    call.dispose();
    resetting.release();
    await syncing;
    expect({
      joined: call.ui.joined,
      open: media.connections.filter((one) => !one.closed).length,
      mic: media.mic.readyState,
      joins: facet.steps.filter((step) => step === "join"),
    }).toEqual({ joined: false, open: 0, mic: "ended", joins: ["join"] });
  } finally {
    vi.useRealTimers();
  }
});

test("a Leave while the receiving connection connects frees the receive queue at once, and says nothing", async () => {
  using _media = browserMedia({ receives: false });
  const facet = callFacet();
  const call = engineOn(facet);
  const view = viewOf(CallLive.parse(callLive({ "a-page": ["mic"], "b-page": ["mic"] })), "a-page");
  // as the page's 5-s tick does: a sync while the join's own reconcile runs subscribes nothing
  const synced = (check: () => void) =>
    vi.waitFor(async () => {
      await call.sync(view);
      check();
    });
  await call.join();
  await synced(() => expect(facet.signals).toContain("renegotiate"));
  await call.leave();
  await call.join();
  await synced(() => expect(facet.signals.filter((step) => step === "subscribe")).toHaveLength(2));
  expect(call.ui).toMatchObject({ error: "" });
  call.dispose();
});

test("a microphone the browser refuses tells the call nothing: no join, no leave", async () => {
  using _media = browserMedia({ refuse: "NotAllowedError" });
  const facet = callFacet();
  const call = engineOn(facet);
  await call.join();
  expect({ steps: facet.steps, joined: call.ui.joined, error: call.ui.error }).toEqual({
    steps: [],
    joined: false,
    error:
      "The browser did not give this page the microphone. Allow it for this site, then join again.",
  });
});

test("a dispose while the call takes the page in tells the call to let go of it", async () => {
  using media = browserMedia();
  const facet = callFacet();
  const call = engineOn(facet);
  const taking = facet.hold("join");
  const joining = call.join();
  await vi.waitFor(() => expect(facet).toMatchObject({ steps: ["join"] }));
  call.dispose();
  taking.release();
  await joining;
  // the leave at once, and again when the join answers, as the facet may take the join in after
  // the first: both are this admission's, so the second removes nothing newer
  await vi.waitFor(() => expect(facet).toMatchObject({ steps: ["join", "leave", "leave"] }));
  expect({ joined: call.ui.joined, mic: media.mic.readyState }).toEqual({
    joined: false,
    mic: "ended",
  });
});

test("a page that joins again keeps its microphone: the browser is not asked for it again", async () => {
  using media = browserMedia();
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    const facet = callFacet();
    const call = engineOn(facet);
    await call.join();
    vi.setSystemTime(Date.now() + 6_000);
    // the call's live state says this page is not in it: the page joins again
    await call.sync(viewOf(CallLive.parse(callLive({})), "a-page"));
    expect({
      joins: facet.steps.filter((step) => step === "join"),
      joined: call.ui.joined,
      opened: media.opened.map((track) => track.readyState),
    }).toEqual({ joins: ["join", "join"], joined: true, opened: ["live"] });
    call.dispose();
  } finally {
    vi.useRealTimers();
  }
});

test("a change of the call while its subscriptions are made is followed once they are", async () => {
  using _media = browserMedia();
  const facet = callFacet();
  const call = engineOn(facet);
  await call.join();
  const subscribing = facet.hold("signal");
  void call.sync(
    viewOf(CallLive.parse(callLive({ "a-page": ["mic"], "b-page": ["mic"] })), "a-page"),
  );
  await vi.waitFor(() => expect(facet.signals).toContain("subscribe"));
  // the other page turns its camera on while the first subscribe runs
  const camera = callLive({ "a-page": ["mic"], "b-page": ["mic", "camera"] });
  void call.sync(viewOf(CallLive.parse(camera), "a-page"));
  subscribing.release();
  await vi.waitFor(() =>
    expect(facet.signals.filter((step) => step === "subscribe")).toHaveLength(2),
  );
  call.dispose();
});

test("a receiving connection that never connects is made anew, as one that broke", async () => {
  using _media = browserMedia({ receives: false });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    const facet = callFacet();
    const call = engineOn(facet);
    await call.join();
    void call.sync(viewOf(CallLive.parse(callLive({ "b-page": ["mic"] })), "a-page"));
    await vi.advanceTimersByTimeAsync(12_000 + 1_000);
    expect(facet.signals).toContain("reset");
    call.dispose();
  } finally {
    vi.useRealTimers();
  }
});

test("a camera pressed while the microphone is still on its way comes on once it is there", async () => {
  using _media = browserMedia();
  const facet = callFacet();
  const call = engineOn(facet);
  const publishing = facet.hold("signal");
  const joining = call.join();
  await vi.waitFor(() => expect(facet).toMatchObject({ steps: ["join", "signal"] }));
  const camera = call.toggleCamera();
  publishing.release();
  await joining;
  await camera;
  expect({ camera: call.ui.camera, published: facet.published }).toEqual({
    camera: true,
    published: ["mic", "camera"],
  });
  call.dispose();
});

test("a camera turned off stops its sender: later offers do not carry it", async () => {
  using media = browserMedia();
  const call = engineOn(callFacet());
  await call.join();
  await call.toggleCamera();
  await call.toggleCamera();
  expect(media.connections[0]!.transceivers.map((one) => one.stopped)).toEqual([false, true]);
  call.dispose();
});

test("a microphone the sender refuses is closed again, and the old one goes on", async () => {
  using media = browserMedia({ replaceFails: true });
  const call = engineOn(callFacet());
  await call.join();
  await call.chooseDevice("mic", "another-mic");
  expect({
    opened: media.opened.map((track) => track.readyState),
    notice: call.ui.notice,
  }).toEqual({
    opened: ["live", "ended"],
    notice: "The new microphone could not be used (the sender refused the track).",
  });
  call.dispose();
});

test("sound the browser held back plays at the person's next click on the page", async () => {
  using media = browserMedia();
  media.play.mockRejectedValueOnce(Object.assign(new Error("no"), { name: "NotAllowedError" }));
  const facet = callFacet();
  const call = engineOn(facet);
  await call.join();
  await call.sync(viewOf(CallLive.parse(callLive({ "b-page": ["mic"] })), "a-page"));
  await vi.waitFor(() => expect(facet.signals).toContain("renegotiate"));
  media.connections[1]!.fire("track", {
    transceiver: { mid: "m-b-page:mic" },
    track: { kind: "audio" },
  });
  await vi.waitFor(() =>
    expect(call.ui).toMatchObject({
      notice: "The browser held back the sound: click anywhere on the page.",
    }),
  );
  document.body.click();
  expect(media.play).toHaveBeenCalledTimes(2);
  call.dispose();
});

test("a track under a mid this page did not subscribe to has no tile", async () => {
  using media = browserMedia();
  const facet = callFacet();
  const call = engineOn(facet);
  await call.join();
  await call.sync(viewOf(CallLive.parse(callLive({ "b-page": ["mic"] })), "a-page"));
  await vi.waitFor(() => expect(facet.signals).toContain("renegotiate"));
  media.connections[1]!.fire("track", {
    transceiver: { mid: "m-other" },
    track: { kind: "video" },
  });
  expect(call.ui).toMatchObject({ videos: [] });
  call.dispose();
});

test("a voice agent that left before its voice was sent is not sent", async () => {
  using media = browserMedia();
  const facet = callFacet();
  const call = engineOn(facet);
  await call.join();
  await call.aiInvite();
  expect(call.ui).toMatchObject({ ai: "on" });
  const voice = media.connections.at(-1)!;
  await call.aiDismiss();
  voice.fire("track", { track: { kind: "audio" } });
  // a camera switch is a job on the sending queue: it ends after the voice's turn
  await call.chooseDevice("camera", "");
  expect({ published: facet.published, error: call.ui.error }).toEqual({
    published: ["mic"],
    error: "",
  });
  call.dispose();
});

test("a dispose closes the voice agent at once: its session at OpenAI and its audio", async () => {
  using media = browserMedia();
  const call = engineOn(callFacet());
  await call.join();
  await call.aiInvite();
  call.dispose();
  expect({
    ai: call.ui.ai,
    sent: media.connections.at(-1)!.channels[0]!.sent,
    audio: media.contexts.map((context) => context.closed),
  }).toEqual({ ai: "off", sent: ['{"type":"session.close"}'], audio: [true] });
});

test("a refusal of another tab's voice agent says why, and throws nothing", async () => {
  using _media = browserMedia();
  const call = engineOn(callFacet({ voiceAgent: new Error("only a member can send it away") }));
  await call.join();
  await call.aiDismiss();
  expect(call.ui).toMatchObject({ error: "only a member can send it away" });
  call.dispose();
});

test("a page whose row is new after a reconnect is out of the call, and is told how to come back", async () => {
  using _media = browserMedia();
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  const held: { call?: ReturnType<typeof useCall>["call"] } = {};
  function Page({ stub, page }: { stub: CallContext; page: string }) {
    const { call, ui } = useCall(stub, page, undefined);
    held.call = call;
    return <p>{ui.notice}</p>;
  }
  try {
    await act(async () => root.render(<Page stub={callFacet()} page="a-page" />));
    await act(async () => held.call!.join());
    await act(async () => root.render(<Page stub={callFacet()} page="a-page-2" />));
    expect(host).toMatchObject({
      textContent:
        "The connection to the mind came back as a new session, so this page left the call. Press Join to come back into it.",
    });
  } finally {
    act(() => root.unmount());
    host.remove();
  }
});

test("a Mute pressed while the page joins again holds for the next call", async () => {
  using media = browserMedia();
  const facet = callFacet();
  const call = engineOn(facet);
  await call.join();
  const resetting = facet.hold("signal", "reset");
  const rejoining = outOfTouch(call);
  await vi.waitFor(() => expect(facet.signals).toContain("reset"));
  call.toggleMute();
  resetting.release();
  await rejoining;
  expect({
    joins: facet.steps.filter((step) => step === "join").length,
    muted: call.ui.muted,
    sending: media.mic.enabled,
  }).toEqual({ joins: 2, muted: true, sending: false });
  call.dispose();
});

test("a Mute pressed while a new microphone takes the old one's place holds for the new one", async () => {
  using media = browserMedia();
  const call = engineOn(callFacet());
  await call.join();
  const replacing = media.hold("replaceTrack");
  const switching = call.chooseDevice("mic", "another-mic");
  await vi.waitFor(() => expect(media.opened).toHaveLength(2));
  call.toggleMute();
  replacing.release();
  await switching;
  expect({ muted: call.ui.muted, sending: media.opened[1]!.enabled }).toEqual({
    muted: true,
    sending: false,
  });
  call.dispose();
});

test("a microphone switch that a rejoin overtakes stops its own new microphone, never the kept one", async () => {
  using media = browserMedia();
  const facet = callFacet();
  const call = engineOn(facet);
  await call.join();
  const opening = media.hold("open");
  const switching = call.chooseDevice("mic", "another-mic");
  const rejoining = outOfTouch(call);
  await vi.waitFor(() => expect(facet.steps.filter((step) => step === "join")).toHaveLength(2));
  opening.release();
  await switching;
  await rejoining;
  // its caller settled at the call's end; the switch's own cleanup still stops what it opened
  await vi.waitFor(() => expect(media.opened[1]!).toMatchObject({ readyState: "ended" }));
  const sending = media.connections.filter((one) => !one.closed)[0]!;
  expect({
    joined: call.ui.joined,
    opened: media.opened.map((track) => track.readyState),
    sent: sending.transceivers[0]!.track === media.opened[0],
  }).toEqual({ joined: true, opened: ["live", "ended"], sent: true });
  call.dispose();
});

test("a repair that joins afresh while the first microphone publish waits still joins, and a dispose then stops everything", async () => {
  using media = browserMedia({ receives: false });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    const facet = callFacet();
    const call = engineOn(facet);
    const publishing = facet.hold("signal", "publish");
    const joining = call.join();
    await vi.advanceTimersByTimeAsync(0);
    void call.sync(viewOf(CallLive.parse(callLive({ "b-page": ["mic"] })), "a-page"));
    // the receiving connection never connects: five repairs, then the page joins afresh
    await vi.advanceTimersByTimeAsync(120_000);
    expect(call.ui).toMatchObject({ joined: true });
    call.dispose();
    publishing.release();
    await joining;
    expect({
      opened: media.opened.filter((track) => track.readyState === "live").length,
      connections: media.connections.filter((one) => !one.closed).length,
    }).toEqual({ opened: 0, connections: 0 });
  } finally {
    vi.useRealTimers();
  }
});

test("a page that only listens and joins afresh after a repair still opens no microphone", async () => {
  using media = browserMedia({ receives: false });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    const facet = callFacet();
    const call = engineOn(facet);
    await call.join({ listenOnly: true });
    void call.sync(viewOf(CallLive.parse(callLive({ "b-page": ["mic"] })), "a-page"));
    // the receiving connection never connects: five repairs, then the page joins afresh
    await vi.advanceTimersByTimeAsync(120_000);
    expect({
      joined: call.ui.joined,
      muted: call.ui.muted,
      joins: facet.steps.filter((one) => one === "join").length > 1,
    }).toEqual({
      joined: true,
      muted: true,
      joins: true,
    });
    expect(media).toMatchObject({ opened: [] });
    call.dispose();
  } finally {
    vi.useRealTimers();
  }
});

test("a page that only listens sends nothing until its Unmute, which publishes the microphone once while the bar shows it at work", async () => {
  using media = browserMedia();
  const facet = callFacet();
  const call = engineOn(facet);
  await call.join({ listenOnly: true });
  expect({ published: facet.published, connections: media.connections.length }).toEqual({
    published: [],
    connections: 0,
  });
  const publishing = facet.hold("signal", "publish");
  call.toggleMute();
  await vi.waitFor(() => expect(facet).toMatchObject({ published: ["mic"] }));
  expect({ unmuting: call.ui.unmuting, muted: call.ui.muted }).toEqual({
    unmuting: true,
    muted: true,
  });
  // a second press while the first is at work changes nothing
  call.toggleMute();
  publishing.release();
  await vi.waitFor(() => expect(call.ui).toMatchObject({ unmuting: false }));
  expect({
    published: facet.published,
    muted: call.ui.muted,
    opened: media.opened.map((track) => track.kind),
  }).toEqual({ published: ["mic"], muted: false, opened: ["audio"] });
  call.dispose();
});

test("a first Unmute whose publish fails leaves the page muted, says why, and closes the microphone", async () => {
  using media = browserMedia();
  const facet = callFacet();
  const call = engineOn(facet);
  await call.join({ listenOnly: true });
  facet.failNext("signal", new Error("the SFU refused the offer"));
  call.toggleMute();
  await vi.waitFor(() => expect(call.ui).toMatchObject({ unmuting: false }));
  expect({
    muted: call.ui.muted,
    notice: call.ui.notice,
    microphone: media.mic.readyState,
    sending: media.connections.filter((one) => !one.closed).length,
  }).toEqual({
    muted: true,
    notice: expect.stringContaining("so you are still muted (the SFU refused the offer)"),
    microphone: "ended",
    sending: 0,
  });
  call.dispose();
});

test("a first Unmute whose sending connection never connects leaves the page muted, and the call forgets its track", async () => {
  using media = browserMedia();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    const facet = callFacet();
    const call = engineOn(facet);
    await call.join({ listenOnly: true });
    media.sends = false;
    call.toggleMute();
    await vi.advanceTimersByTimeAsync(15_000);
    expect({
      muted: call.ui.muted,
      unmuting: call.ui.unmuting,
      notice: call.ui.notice,
      signals: facet.signals,
      open: media.connections.filter((one) => !one.closed).length,
      microphone: media.mic.readyState,
    }).toEqual({
      muted: true,
      unmuting: false,
      notice: expect.stringContaining("so you are still muted (Sending: no connection"),
      signals: ["publish", "reset"],
      open: 0,
      microphone: "ended",
    });
    call.dispose();
  } finally {
    vi.useRealTimers();
  }
});

test("a page that only listens sends its camera as its first track, and an Unmute then puts the microphone beside it", async () => {
  using media = browserMedia();
  const facet = callFacet();
  const call = engineOn(facet);
  await call.join({ listenOnly: true });
  await call.toggleCamera();
  expect({ camera: call.ui.camera, published: facet.published }).toEqual({
    camera: true,
    published: ["camera"],
  });
  call.toggleMute();
  await vi.waitFor(() => expect(call.ui).toMatchObject({ muted: false }));
  expect({
    published: facet.published,
    // one sending connection, with both senders
    senders: media.connections.map((one) => one.transceivers.length),
  }).toEqual({ published: ["camera", "mic"], senders: [2] });
  call.dispose();
});

test("a receiving session the SFU ended (410) is made anew by the repair, and the page says no error", async () => {
  using _media = browserMedia();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    const facet = callFacet();
    const call = engineOn(facet);
    await call.join();
    facet.failNext("signal", sessionEnded());
    void call.sync(viewOf(CallLive.parse(callLive({ "b-page": ["mic"] })), "a-page"));
    await vi.advanceTimersByTimeAsync(5_000);
    expect({
      subscribes: facet.signals.filter((step) => step === "subscribe").length,
      resets: facet.signals.filter((step) => step === "reset").length,
      error: call.ui.error,
      repair: call.ui.repair,
    }).toEqual({ subscribes: 2, resets: 1, error: "", repair: "" });
    call.dispose();
  } finally {
    vi.useRealTimers();
  }
});

test("a receiving session the SFU keeps refusing (410): the bounded repair, one rejoin, then the page leaves, says so, and asks nothing more", async () => {
  using _media = browserMedia();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    const facet = callFacet();
    const call = engineOn(facet);
    facet.failStep("subscribe", sessionEnded());
    await call.join();
    void call.sync(viewOf(CallLive.parse(callLive({ "b-page": ["mic"] })), "a-page"));
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    const steps = facet.steps.length;
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect({
      more: facet.steps.length - steps,
      leaves: facet.steps.filter((step) => step === "leave").length,
      joined: call.ui.joined,
      error: call.ui.error,
    }).toEqual({
      more: 0,
      leaves: 1,
      joined: false,
      error: expect.stringMatching(
        /^Your receiving connection could not be repaired \(The SFU answered 410.*\)\. Press Join/,
      ),
    });
  } finally {
    vi.useRealTimers();
  }
});

test("a camera's prompt left open does not hold up the next call's microphone", async () => {
  using media = browserMedia();
  const facet = callFacet();
  const call = engineOn(facet);
  await call.join();
  const prompt = media.hold("open");
  const camera = call.toggleCamera();
  await call.leave();
  await call.join();
  expect({ joined: call.ui.joined, published: facet.published }).toEqual({
    joined: true,
    published: ["mic", "mic"],
  });
  prompt.release();
  await camera;
  // the camera came after its call ended: it is closed, and not on in the new one
  await vi.waitFor(() => expect(media.opened).toHaveLength(3));
  await vi.waitFor(() => expect(media.opened.at(-1)).toMatchObject({ readyState: "ended" }));
  expect({ camera: call.ui.camera, track: media.opened.at(-1)!.readyState }).toEqual({
    camera: false,
    track: "ended",
  });
  call.dispose();
});

test("a Leave while the first microphone publish waits lets a new Join start at once", async () => {
  using _media = browserMedia();
  const facet = callFacet();
  const call = engineOn(facet);
  const publishing = facet.hold("signal", "publish");
  const first = call.join();
  await vi.waitFor(() => expect(facet).toMatchObject({ published: ["mic"] }));
  await call.leave();
  await call.join();
  expect(call.ui).toMatchObject({ joined: true, joining: false });
  publishing.release();
  await first;
  // the first join's end does not touch the call that came after it
  expect(call.ui).toMatchObject({ joined: true, joining: false });
  call.dispose();
});

test("a dispose while a new camera takes the old one's place stops the new camera too", async () => {
  using media = browserMedia();
  const call = engineOn(callFacet());
  await call.join();
  await call.toggleCamera();
  const scaling = media.hold("setParameters");
  const switching = call.chooseDevice("camera", "another-camera");
  await vi.waitFor(() => expect(media.opened).toHaveLength(3));
  call.dispose();
  scaling.release();
  await switching;
  expect(media.opened.map((track) => track.readyState)).toEqual(["ended", "ended", "ended"]);
});

test("a dispose while a camera waits for its first publish stops the camera", async () => {
  using media = browserMedia();
  const facet = callFacet();
  const call = engineOn(facet);
  await call.join();
  const publishing = facet.hold("signal", "publish");
  const camera = call.toggleCamera();
  await vi.waitFor(() => expect(facet).toMatchObject({ published: ["mic", "camera"] }));
  call.dispose();
  publishing.release();
  await camera;
  expect({ camera: call.ui.camera, track: media.opened[1]!.readyState }).toEqual({
    camera: false,
    track: "ended",
  });
});

test("a dispose while the microphone waits for the call's answer closes its connection at once", async () => {
  using media = browserMedia();
  const facet = callFacet();
  const call = engineOn(facet);
  const publishing = facet.hold("signal", "publish");
  const joining = call.join();
  await vi.waitFor(() => expect(facet).toMatchObject({ published: ["mic"] }));
  call.dispose();
  expect(media.connections.map((one) => one.closed)).toEqual([true]);
  publishing.release();
  await joining;
});

test("a receiving connection that never connects: one rejoin, then the page leaves and says so, and nothing loops", async () => {
  using _media = browserMedia({ receives: false });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    const facet = callFacet();
    const call = engineOn(facet);
    await call.join();
    void call.sync(viewOf(CallLive.parse(callLive({ "b-page": ["mic"] })), "a-page"));
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    const steps = facet.steps.length;
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect({
      more: facet.steps.length - steps,
      leaves: facet.steps.filter((step) => step === "leave").length,
      resets: facet.signals.filter((step) => step === "reset").length,
      joined: call.ui.joined,
      error: call.ui.error,
    }).toEqual({
      more: 0,
      leaves: 1,
      // five repairs in each of the two calls, and the rejoin's two
      resets: 12,
      joined: false,
      error: expect.stringMatching(/^Your receiving connection could not be repaired .*Press Join/),
    });
  } finally {
    vi.useRealTimers();
  }
});

test("a dispose while a repair resets the receiving session leaves no connection open", async () => {
  using media = browserMedia({ receives: false });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    const facet = callFacet();
    const call = engineOn(facet);
    await call.join();
    const resetting = facet.hold("signal", "reset");
    void call.sync(viewOf(CallLive.parse(callLive({ "b-page": ["mic"] })), "a-page"));
    await vi.advanceTimersByTimeAsync(12_000 + 1_000);
    expect(facet.signals).toContain("reset");
    call.dispose();
    resetting.release();
    await vi.advanceTimersByTimeAsync(0);
    expect(media.connections.filter((one) => !one.closed)).toEqual([]);
  } finally {
    vi.useRealTimers();
  }
});

test("an invite's late answer after a leave and a new invite leaves the new voice agent alone", async () => {
  using media = browserMedia();
  const facet = callFacet();
  const call = engineOn(facet);
  await call.join();
  const answering = facet.hold("voiceAgent");
  const first = call.aiInvite();
  await vi.waitFor(() => expect(facet.steps).toContain("voiceAgent"));
  await call.leave();
  await call.join();
  await call.aiInvite();
  answering.release();
  await first;
  expect({
    ai: call.ui.ai,
    closed: media.connections.at(-1)!.channels[0]!.sent,
  }).toEqual({ ai: "on", closed: [] });
  call.dispose();
});

test("a Leave while hosting the voice agent closes the microphone at once, and the call hears one leave, which ends the agent", async () => {
  using media = browserMedia();
  const facet = callFacet();
  const call = engineOn(facet);
  await call.join();
  await call.aiInvite();
  const leaving = call.leave();
  expect({
    mic: media.mic.readyState,
    open: media.connections.filter((one) => !one.closed).length,
  }).toEqual({ mic: "ended", open: 0 });
  await leaving;
  expect(facet.steps.slice(-2)).toEqual(["voiceAgent", "leave"]);
});

test("a Leave whose voice agent's channel throws still closes the microphone and the camera", async () => {
  using media = browserMedia();
  const call = engineOn(callFacet());
  await call.join();
  await call.toggleCamera();
  await call.aiInvite();
  Object.assign(media.connections.at(-1)!.channels[0]!, {
    send: () => {
      throw Object.assign(new Error("the channel is closing"), { name: "OperationError" });
    },
  });
  await call.leave();
  expect({
    tracks: media.opened.map((track) => track.readyState),
    open: media.connections.filter((one) => !one.closed).length,
  }).toEqual({ tracks: ["ended", "ended"], open: 0 });
});

test("a Join right after a Leave of a voice agent's host: the old leave never comes after the new join", async () => {
  using _media = browserMedia();
  const facet = callFacet();
  const call = engineOn(facet);
  await call.join();
  await call.aiInvite();
  const stopping = facet.hold("voiceAgent");
  const leaving = call.leave();
  await call.join();
  stopping.release();
  await leaving;
  expect({
    joined: call.ui.joined,
    afterJoin: facet.steps.slice(facet.steps.lastIndexOf("join")).includes("leave"),
  }).toEqual({ joined: true, afterJoin: false });
  call.dispose();
});

test("a join the call took in after its Leave, behind a newer join: the next Leave is still sent", async () => {
  using media = browserMedia();
  const facet = callFacet();
  const call = engineOn(facet);
  const admitting = facet.hold("join");
  const first = call.join();
  await vi.waitFor(() => expect(facet.steps).toContain("join"));
  await call.leave();
  const opening = media.hold("open");
  const second = call.join();
  admitting.release();
  await first;
  await call.leave();
  opening.release();
  await second;
  // the first Leave's, at once and again at the late answer: both the first admission's
  expect(facet.steps.filter((step) => step === "leave")).toEqual(["leave", "leave"]);
});

test("an old sending repair whose reset answers after a Leave and a Join offers the new call nothing", async () => {
  using media = browserMedia();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    const facet = callFacet();
    const call = engineOn(facet);
    await call.join();
    const sending = media.connections[0]!;
    sending.fire("connectionstatechange", {});
    sending.connectionState = "failed";
    const resetting = facet.hold("signal", "reset");
    sending.fire("connectionstatechange", {});
    await vi.advanceTimersByTimeAsync(1_000);
    expect(facet.signals).toContain("reset");
    await call.leave();
    await call.join();
    const offers = facet.published.length;
    resetting.release();
    await vi.advanceTimersByTimeAsync(0);
    expect(facet.published.length).toBe(offers);
    call.dispose();
  } finally {
    vi.useRealTimers();
  }
});

test("a second Share press while the screen's picker is open turns it off: the chosen screen is not sent", async () => {
  using media = browserMedia();
  const facet = callFacet();
  const call = engineOn(facet);
  await call.join();
  const choosing = media.hold("display");
  const first = call.toggleScreen();
  const second = call.toggleScreen();
  choosing.release();
  await first;
  await second;
  expect({
    screen: call.ui.screen,
    published: facet.published,
    pickers: media.displays,
    picture: media.opened.at(-1)!.readyState,
  }).toEqual({ screen: false, published: ["mic"], pickers: 1, picture: "ended" });
  call.dispose();
});

test("a screen whose share the browser stopped while it waited for the microphone is not sent", async () => {
  using media = browserMedia();
  const facet = callFacet();
  const call = engineOn(facet);
  const publishing = facet.hold("signal", "publish");
  const joining = call.join();
  await vi.waitFor(() => expect(facet).toMatchObject({ published: ["mic"] }));
  const screen = call.toggleScreen();
  await vi.waitFor(() => expect(media.opened).toHaveLength(2));
  // the browser's own "Stop sharing"
  media.opened[1]!.readyState = "ended";
  publishing.release();
  await joining;
  await screen;
  expect({ screen: call.ui.screen, published: facet.published }).toEqual({
    screen: false,
    published: ["mic"],
  });
  call.dispose();
});

test("device changes behind an unanswered microphone prompt settle at a Leave, and put no error on the next call", async () => {
  using media = browserMedia();
  const call = engineOn(callFacet());
  await call.join();
  await call.toggleCamera();
  const opening = media.hold("open");
  const switchingMic = call.chooseDevice("mic", "another-mic");
  const switchingCamera = call.chooseDevice("camera", "another-camera");
  // the microphone's prompt is open, and the camera's switch waits behind it
  await new Promise((resolve) => setTimeout(resolve, 0));
  await call.leave();
  await switchingMic;
  await switchingCamera;
  await call.join();
  opening.release();
  await vi.waitFor(() => expect(media.opened.at(-1)?.readyState).toBe("ended"));
  expect(call.ui).toMatchObject({ joined: true, error: "" });
  call.dispose();
});

test("a new call subscribes while the old call's subscribe is still unanswered", async () => {
  using _media = browserMedia();
  const facet = callFacet();
  const call = engineOn(facet);
  await call.join();
  const subscribing = facet.hold("signal", "subscribe");
  const others = viewOf(CallLive.parse(callLive({ "b-page": ["mic"] })), "a-page");
  void call.sync(others);
  await vi.waitFor(() => expect(facet.signals).toContain("subscribe"));
  await call.leave();
  await call.join();
  void call.sync(others);
  await vi.waitFor(() =>
    expect(facet.signals.filter((step) => step === "subscribe")).toHaveLength(2),
  );
  subscribing.release();
  call.dispose();
});

test("a live state that keeps saying 'not in the call' makes one rejoin, then the page leaves and says so", async () => {
  using _media = browserMedia();
  const facet = callFacet();
  const call = engineOn(facet);
  await call.join();
  for (const _ of [1, 2, 3]) await outOfTouch(call);
  expect({
    joins: facet.steps.filter((step) => step === "join").length,
    joined: call.ui.joined,
    error: call.ui.error,
  }).toEqual({
    joins: 2,
    joined: false,
    error: "This page was out of touch with the call. Press Join to try again.",
  });
});

test("a kept microphone unplugged while the call takes the page in again: the default is sent, with its mute", async () => {
  using media = browserMedia();
  const facet = callFacet();
  const call = engineOn(facet);
  await call.join();
  call.toggleMute();
  const admitting = facet.hold("join");
  const rejoining = outOfTouch(call);
  await vi.waitFor(() => expect(facet.steps.filter((step) => step === "join")).toHaveLength(2));
  media.mic.stop();
  admitting.release();
  await rejoining;
  const sending = media.connections.filter((one) => !one.closed)[0]!;
  expect({
    sent: sending.transceivers[0]!.track.readyState,
    muted: !sending.transceivers[0]!.track.enabled,
    ui: call.ui.muted,
  }).toEqual({ sent: "live", muted: true, ui: true });
  call.dispose();
});

test("an invite still making its offer after a Leave and a Join asks the new call for no agent", async () => {
  using media = browserMedia();
  const facet = callFacet();
  const call = engineOn(facet);
  await call.join();
  const offering = media.hold("offer");
  const inviting = call.aiInvite();
  await vi.waitFor(() => expect(media.contexts).toHaveLength(1));
  await call.leave();
  await call.join();
  offering.release();
  await inviting;
  expect({ ai: call.ui.ai, asked: facet.steps.filter((step) => step === "voiceAgent") }).toEqual({
    ai: "off",
    asked: [],
  });
  call.dispose();
});

test("an old rejoin whose agent stop answers after a Leave and a Join resets nothing of the new call", async () => {
  using _media = browserMedia();
  const facet = callFacet();
  const call = engineOn(facet);
  await call.join();
  await call.aiInvite();
  const stopping = facet.hold("voiceAgent");
  const rejoining = outOfTouch(call);
  await vi.waitFor(() => expect(facet.steps.at(-1)).toBe("voiceAgent"));
  await call.leave();
  await call.join();
  const resets = facet.signals.filter((step) => step === "reset").length;
  stopping.release();
  await rejoining;
  expect({
    joined: call.ui.joined,
    resets: facet.signals.filter((step) => step === "reset").length,
  }).toEqual({ joined: true, resets });
  call.dispose();
});

test("a receiving connection that comes back by itself before its first try takes its error with it", async () => {
  using media = browserMedia({ receives: false });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    const call = engineOn(callFacet());
    await call.join();
    void call.sync(viewOf(CallLive.parse(callLive({ "b-page": ["mic"] })), "a-page"));
    await vi.advanceTimersByTimeAsync(12_000);
    expect(call.ui.error).toMatch(/^Receiving: no connection to Cloudflare in 12 s/);
    media.connections.at(-1)!.connectionState = "connected";
    await vi.advanceTimersByTimeAsync(1_000);
    expect(call.ui).toMatchObject({ error: "" });
    call.dispose();
  } finally {
    vi.useRealTimers();
  }
});

test("admission order 1: an old engine's owed Leave carries its own admission, never the new engine's", async () => {
  using _media = browserMedia();
  const facet = callFacet();
  const old = engineOn(facet);
  const taking = facet.hold("join");
  const joining = old.join();
  await vi.waitFor(() => expect(facet.steps).toContain("join"));
  // the context object changed, the row stayed: a new engine on the same row
  old.dispose();
  const fresh = engineOn(facet);
  await fresh.join();
  taking.release();
  await joining;
  const [oldAdmission, newAdmission] = admissionsOf(facet, "join");
  expect(newAdmission).not.toBe(oldAdmission);
  expect(new Set(admissionsOf(facet, "leave"))).toEqual(new Set([oldAdmission]));
  fresh.dispose();
});

test("admission order 3: an old camera offer still gathering after a Leave and a Join is never sent", async () => {
  using media = browserMedia();
  const facet = callFacet();
  const call = engineOn(facet);
  await call.join();
  const offering = media.hold("offer");
  const camera = call.toggleCamera();
  await vi.waitFor(() => expect(media.opened).toHaveLength(2));
  await call.leave();
  await call.join();
  offering.release();
  await camera;
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(facet).toMatchObject({ published: ["mic", "mic"] });
  call.dispose();
});

test("admission order 4: an old switch's late microphone never takes the newer switch's Mute", async () => {
  using media = browserMedia();
  const call = engineOn(callFacet());
  await call.join();
  const opening = media.hold("open");
  const oldSwitch = call.chooseDevice("mic", "mic-old");
  await new Promise((resolve) => setTimeout(resolve, 0));
  await call.leave();
  await call.join();
  const replacing = media.hold("replaceTrack");
  const newSwitch = call.chooseDevice("mic", "mic-new");
  await vi.waitFor(() => expect(media.opened).toHaveLength(3));
  opening.release();
  await oldSwitch;
  // the old switch's capture comes back while the new one replaces its track: then Mute
  await vi.waitFor(() => expect(media.opened).toHaveLength(4));
  await new Promise((resolve) => setTimeout(resolve, 0));
  call.toggleMute();
  // the new microphone is silent from the press, also while its track is being put in place
  expect(media.opened[2]).toMatchObject({ enabled: false });
  replacing.release();
  await newSwitch;
  // opened: the first mic, the second call's, the new switch's, then the old switch's late one
  const [, , switched, late] = media.opened;
  expect({
    muted: call.ui.muted,
    sending: switched!.enabled,
    live: switched!.readyState,
    late: late!.readyState,
  }).toEqual({ muted: true, sending: false, live: "live", late: "ended" });
  call.dispose();
});

test("admission order 4: a chosen device that fails after a Leave opens no default device", async () => {
  using media = browserMedia();
  const call = engineOn(callFacet());
  await call.join();
  const opening = media.hold("open");
  media.refuseNext("NotFoundError");
  const switching = call.chooseDevice("mic", "gone-mic");
  await new Promise((resolve) => setTimeout(resolve, 0));
  await call.leave();
  opening.release();
  await switching;
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(media.opened.map((track) => track.readyState)).toEqual(["ended"]);
});

test("admission order 5: a TURN refresh carries its admission, and one that answers after a Leave sets no new refresh", async () => {
  using _media = browserMedia();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    const facet = callFacet();
    const call = engineOn(facet);
    await call.join();
    const refreshing = facet.hold("join");
    await vi.advanceTimersByTimeAsync(60 * 750);
    expect(facet.calls.filter((one) => one.method === "join").map(({ args }) => args)).toEqual([
      [{ admit: admissionsOf(facet, "join")[0], seq: expect.any(Number) }],
      [{ admission: admissionsOf(facet, "join")[0] }],
    ]);
    await call.leave();
    refreshing.release();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(facet.steps.filter((step) => step === "join")).toHaveLength(2);
  } finally {
    vi.useRealTimers();
  }
});

test("admission order 6: a join whose answer failed after the call may have taken the page in still sends its leave", async () => {
  using _media = browserMedia();
  const facet = callFacet({ join: new Error("the call's setup failed") });
  const call = engineOn(facet);
  await call.join();
  expect({ joined: call.ui.joined, leaves: admissionsOf(facet, "leave") }).toEqual({
    joined: false,
    leaves: admissionsOf(facet, "join"),
  });
});

test("admission order 6: a dispose of a page in the call sends its admission's leave", async () => {
  using _media = browserMedia();
  const facet = callFacet();
  const call = engineOn(facet);
  await call.join();
  call.dispose();
  await vi.waitFor(() => expect(admissionsOf(facet, "leave")).toEqual(admissionsOf(facet, "join")));
});

test("admission order 7: a dispose while the microphone's prompt is open settles the Join at once", async () => {
  using media = browserMedia();
  const call = engineOn(callFacet());
  media.hold("open");
  const joining = call.join();
  await new Promise((resolve) => setTimeout(resolve, 0));
  call.dispose();
  await joining;
  expect(call.ui).toMatchObject({ joined: false, joining: false });
});

test("admission order 7: a screen chosen after its press was turned off closes at once, not at its turn", async () => {
  using media = browserMedia();
  const facet = callFacet();
  const call = engineOn(facet);
  const publishing = facet.hold("signal", "publish");
  const joining = call.join();
  await vi.waitFor(() => expect(facet).toMatchObject({ published: ["mic"] }));
  const choosing = media.hold("display");
  const first = call.toggleScreen();
  const off = call.toggleScreen();
  choosing.release();
  await first;
  expect(media.opened.at(-1)).toMatchObject({ kind: "video", readyState: "ended" });
  publishing.release();
  await joining;
  await off;
  call.dispose();
});

test("follow-up order 2: a dismiss while the voice agent's start is under way withdraws that invite, by its id", async () => {
  using _media = browserMedia();
  const facet = callFacet();
  const call = engineOn(facet);
  await call.join();
  const starting = facet.hold("voiceAgent");
  const inviting = call.aiInvite();
  await vi.waitFor(() => expect(facet.steps).toContain("voiceAgent"));
  await call.aiDismiss();
  starting.release();
  await inviting;
  const [start, stop] = facet.calls
    .filter((one) => one.method === "voiceAgent")
    .map(({ args }) => args[0] as { invite?: string });
  // no `stop`: a call from before `withdraw` refuses it, and sends away no other page's agent
  expect([start, stop]).toEqual([
    { start: "v=0", invite: expect.any(String) },
    { withdraw: start?.invite, why: "sent away" },
  ]);
  call.dispose();
});

test("follow-up order 2: an invite after a dismissed one waits for that one's answer: one start of a page at a time", async () => {
  using _media = browserMedia();
  const facet = callFacet();
  const call = engineOn(facet);
  await call.join();
  const starting = facet.hold("voiceAgent");
  const first = call.aiInvite();
  await vi.waitFor(() => expect(facet.steps).toContain("voiceAgent"));
  await call.aiDismiss();
  const second = call.aiInvite();
  await new Promise((resolve) => setTimeout(resolve, 20));
  const starts = () =>
    facet.calls.filter((one) => one.method === "voiceAgent" && "start" in (one.args[0] as object))
      .length;
  expect(starts()).toBe(1);
  starting.release();
  await first;
  await second;
  expect(starts()).toBe(2);
  call.dispose();
});

test("follow-up order 5: a rejoin whose new admission fails sends the earlier admission's leave", async () => {
  using _media = browserMedia();
  const facet = callFacet();
  const call = engineOn(facet);
  await call.join();
  facet.failNext("join", new Error("the call's setup failed"));
  await outOfTouch(call);
  const [first, second] = admissionsOf(facet, "join");
  expect(new Set(admissionsOf(facet, "leave"))).toEqual(new Set([first, second]));
});

test("follow-up order 7: an Off of a screen that waits for its turn stops it at once", async () => {
  using media = browserMedia();
  const facet = callFacet();
  const call = engineOn(facet);
  const publishing = facet.hold("signal", "publish");
  const joining = call.join();
  await vi.waitFor(() => expect(facet).toMatchObject({ published: ["mic"] }));
  const sharing = call.toggleScreen();
  await vi.waitFor(() => expect(media.opened).toHaveLength(2));
  const off = call.toggleScreen();
  expect(media.opened[1]).toMatchObject({ readyState: "ended" });
  publishing.release();
  await joining;
  await sharing;
  await off;
  expect(facet).toMatchObject({ published: ["mic"] });
  call.dispose();
});

test("follow-up order 7: a dispose while the call has not answered the join settles the Join, and the late answer gets its leave", async () => {
  using _media = browserMedia();
  const facet = callFacet();
  const call = engineOn(facet);
  const taking = facet.hold("join");
  const joining = call.join();
  await vi.waitFor(() => expect(facet.steps).toContain("join"));
  call.dispose();
  await joining;
  expect(call.ui).toMatchObject({ joined: false, joining: false });
  taking.release();
  await vi.waitFor(() => expect(admissionsOf(facet, "leave")).toHaveLength(2));
  expect(new Set(admissionsOf(facet, "leave"))).toEqual(new Set(admissionsOf(facet, "join")));
});

test("a voice agent sent away while a sending repair offers its voice again: that voice goes out of the call", async () => {
  using media = browserMedia();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    const facet = callFacet();
    const call = engineOn(facet);
    await call.join();
    await call.aiInvite();
    media.connections.at(-1)!.fire("track", { track: { kind: "audio" } });
    await vi.waitFor(() => expect(facet).toMatchObject({ published: ["mic", "ai"] }));
    const sending = media.connections[0]!;
    sending.fire("connectionstatechange", {});
    sending.connectionState = "failed";
    const resetting = facet.hold("signal", "reset");
    sending.fire("connectionstatechange", {});
    await vi.advanceTimersByTimeAsync(1_000);
    expect(facet.signals).toContain("reset");
    // the rebuilt connection offers the microphone first, then the voice
    const offeringMic = media.hold("offer");
    resetting.release();
    await vi.advanceTimersByTimeAsync(0);
    const rebuilt = media.connections.at(-1)!;
    await vi.waitFor(() => expect(rebuilt.transceivers).toHaveLength(1));
    const offering = media.hold("offer");
    offeringMic.release();
    await vi.waitFor(() => expect(rebuilt.transceivers).toHaveLength(2));
    await call.aiDismiss();
    offering.release();
    await vi.advanceTimersByTimeAsync(0);
    expect(rebuilt.transceivers.map((one) => one.stopped)).toEqual([false, true]);
    call.dispose();
  } finally {
    vi.useRealTimers();
  }
});

test("a voice agent sent away while its voice is offered: the voice goes out of the call again", async () => {
  using media = browserMedia();
  const facet = callFacet();
  const call = engineOn(facet);
  await call.join();
  await call.aiInvite();
  const offering = facet.hold("signal", "publish");
  media.connections.at(-1)!.fire("track", { track: { kind: "audio" } });
  await vi.waitFor(() => expect(facet).toMatchObject({ published: ["mic", "ai"] }));
  await call.aiDismiss();
  offering.release();
  await vi.waitFor(() => expect(facet.signals).toContain("unpublish"));
  expect(media.connections[0]!.transceivers.map((one) => one.stopped)).toEqual([false, true]);
  call.dispose();
});

test("the screen's picker opens from the press itself, while the microphone is still on its way", async () => {
  using media = browserMedia();
  const facet = callFacet();
  const call = engineOn(facet);
  const publishing = facet.hold("signal", "publish");
  const joining = call.join();
  await vi.waitFor(() => expect(facet).toMatchObject({ published: ["mic"] }));
  const screen = call.toggleScreen();
  expect(media).toMatchObject({ displays: 1 });
  publishing.release();
  await joining;
  await screen;
  expect({ screen: call.ui.screen, published: facet.published }).toEqual({
    screen: true,
    published: ["mic", "screen"],
  });
  // a screen chosen after its call ended is closed
  await call.toggleScreen();
  const choosing = media.hold("display");
  const late = call.toggleScreen();
  await call.leave();
  choosing.release();
  await late;
  expect(media.opened.at(-1)).toMatchObject({ kind: "video", readyState: "ended" });
});

test("a receiving connection's error goes once its repair worked", async () => {
  using media = browserMedia({ receives: false });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    const call = engineOn(callFacet());
    await call.join();
    void call.sync(viewOf(CallLive.parse(callLive({ "b-page": ["mic"] })), "a-page"));
    await vi.advanceTimersByTimeAsync(12_000);
    expect(call.ui.error).toMatch(/^Receiving: no connection to Cloudflare in 12 s/);
    media.receives = true;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(call.ui).toMatchObject({
      error: "",
      notice: "Your receiving connection is repaired.",
    });
    call.dispose();
  } finally {
    vi.useRealTimers();
  }
});

test("why the voice agent did not come is gone when the next call starts", async () => {
  using _media = browserMedia();
  const call = engineOn(callFacet({ voiceAgent: new Error("no key") }));
  await call.join();
  await call.aiInvite();
  expect(call.ui).toMatchObject({ aiRefusal: { message: "no key" } });
  await call.leave();
  await call.join();
  expect(call.ui).toMatchObject({ aiRefusal: null });
  call.dispose();
});

test("a Start whose page went into the back-forward cache while the call came on joins nothing on its return", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  using media = browserMedia();
  const facet = callFacet();
  let enabled = () => {};
  await using page = await drawCall(
    facet,
    () => new Promise<void>((resolve) => (enabled = resolve)),
  );
  await act(async () => buttonOf(page.place, "Start a call").click());
  await act(async () => {
    dispatchEvent(new Event("pagehide"));
    dispatchEvent(new Event("pageshow"));
  });
  await act(async () => enabled());
  expect({ steps: facet.steps, opened: media.opened }).toEqual({ steps: [], opened: [] });
  expect(buttonsOf(page.place)).not.toContain("Starting…");
});

test("a Start whose page went away while the call came on joins nothing and opens no microphone", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  using media = browserMedia();
  const facet = callFacet();
  let enabled = () => {};
  const page = await drawCall(facet, () => new Promise<void>((resolve) => (enabled = resolve)));
  await act(async () => buttonOf(page.place, "Start a call").click());
  await page[Symbol.asyncDispose]();
  enabled();
  await act(async () => {});
  expect({ steps: facet.steps, opened: media.opened }).toEqual({ steps: [], opened: [] });
});

test("someone watching an empty call hears the first arrival, and a page alone sees its notice", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  using _media = browserMedia();
  const facet = callFacet();
  await using page = await drawCall(facet, async () => {});
  await act(async () => page.update({ facetOn: true, live: callLive({}) }));
  await act(async () => page.update({ facetOn: true, live: callLive({ "b-page": ["mic"] }) }));
  const tiles = () => document.querySelector("[data-slot=agent-call-tiles]");
  expect(tiles()?.querySelector("[aria-live=polite]")?.textContent).toBe(
    "b@example.com joined the call.",
  );
  // this page alone in the call, then a new row after a reconnect: the notice says how to come back
  await act(async () => page.update({ facetOn: true, live: callLive({}) }));
  await act(async () => buttonOf(page.place, "Join the call").click());
  await act(() => vi.waitFor(() => buttonOf(page.place, "Leave the call")));
  await act(async () => page.update({ facetOn: true, live: callLive({}), row: "a-page-2" }));
  expect(tiles()?.querySelector("[data-slot=call-tiles]")?.textContent).toContain(
    "Press Join to come back into it.",
  );
});

test("a start whose microphone is open while it publishes: Mute and Leave show, not Starting… alone", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  using _media = browserMedia();
  const facet = callFacet();
  const publishing = facet.hold("signal");
  await using page = await drawCall(facet, async () => page.update({ facetOn: true }));
  await act(async () => buttonOf(page.place, "Start a call").click());
  await act(() => vi.waitFor(() => expect(facet).toMatchObject({ steps: ["join", "signal"] })));
  expect([buttonOf(page.place, "Mute"), buttonOf(page.place, "Leave the call")]).toMatchObject([
    { disabled: false },
    { disabled: false },
  ]);
  // a Leave before the join has ended: Join stands, not a Starting… that nothing ends
  await act(async () => buttonOf(page.place, "Leave the call").click());
  expect(buttonOf(page.place, "Join the call")).toBeTruthy();
  expect(page.place.textContent).not.toContain("Starting…");
  await act(async () => publishing.release());
});

test("on a phone, a start outlives the bar's popover, and the call's button says when the page is in the call", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  using _media = browserMedia();
  const facet = callFacet();
  let enabled = () => {};
  await using page = await drawCall(
    facet,
    () => new Promise<void>((resolve) => (enabled = resolve)),
    { narrow: true },
  );
  const trigger = page.place.querySelector("button")!;
  await act(async () => trigger.click());
  await act(async () => buttonOf(document.body, "Start a call").click());
  // the popover closes, and opens again while the start runs
  await act(async () => trigger.click());
  await act(async () => trigger.click());
  expect(buttonOf(document.body, "Starting…")).toBeTruthy();
  expect(buttonsOf(document.body)).not.toContain("Start a call");
  await act(async () => {
    page.update({ facetOn: true });
    enabled();
  });
  await act(() =>
    vi.waitFor(() => expect(trigger.getAttribute("aria-label")).toBe("Call: you are in it")),
  );
});

test("on a phone, a page in the call with an error: the call's button says both", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  using _media = browserMedia();
  const facet = callFacet({ voiceAgent: new Error("no key") });
  await using page = await drawCall(facet, async () => {}, { narrow: true });
  await act(async () => page.update({ facetOn: true, live: callLive({}) }));
  const trigger = page.place.querySelector("button")!;
  await act(async () => trigger.click());
  await act(async () => buttonOf(document.body, "Join the call").click());
  await act(() => vi.waitFor(() => buttonOf(document.body, "Add a voice agent")));
  await act(async () => buttonOf(document.body, "Add a voice agent").click());
  await act(() =>
    vi.waitFor(() =>
      expect(trigger.getAttribute("aria-label")).toBe("Call: you are in it, and an error"),
    ),
  );
});

test("a mind with no SFU app: the tiles over the feed say why Join cannot be pressed", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const facet = callFacet();
  await using page = await drawCall(facet, async () => {});
  await act(async () =>
    page.update({
      facetOn: true,
      live: { ...callLive({}), setup: { sfu: false, turn: false, voice: false } },
    }),
  );
  expect(buttonOf(page.place, "This mind has no call service yet")).toMatchObject({
    disabled: true,
  });
  expect(document.querySelector("[data-slot=agent-call-tiles]")?.textContent).toContain(
    "This mind has no Cloudflare Realtime SFU app yet",
  );
});

test("a start whose call came on but whose join failed: the call's words, and Join to press again", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  using _media = browserMedia();
  const facet = callFacet({ join: new Error("the call has no SFU app") });
  await using page = await drawCall(facet, async () => page.update({ facetOn: true }));
  await act(async () => buttonOf(page.place, "Start a call").click());
  await act(() =>
    vi.waitFor(() =>
      expect(page.place.querySelector("[role=alert]")?.textContent).toBe("the call has no SFU app"),
    ),
  );
  expect(buttonOf(page.place, "Join the call")).toMatchObject({
    disabled: false,
  });
  expect(page.seen.filter((buttons) => buttons.length === 0)).toEqual([]);
});

test("a start whose join fails before the table shows the call: Join, never Start again", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  using _media = browserMedia();
  const facet = callFacet({ join: new Error("the call has no SFU app") });
  // the call came on, but neither its row nor its live state has reached the page yet
  await using page = await drawCall(facet, async () => {});
  await act(async () => buttonOf(page.place, "Start a call").click());
  await act(() =>
    vi.waitFor(() =>
      expect(page.place.querySelector("[role=alert]")?.textContent).toBe("the call has no SFU app"),
    ),
  );
  expect(buttonsOf(page.place)).toContain("Join the call");
  expect(buttonsOf(page.place)).not.toContain("Start a call");
});

/** A mind whose logs are empty but for `logs`: what the page appends to a log is kept in
 *  `appended`, and the ephemeral events it sends (its `presence/status`) in `sent`. `pages`: the
 *  pages other members hold open on a context, by path, as its subscription rows and lent stubs.
 *  `hold()` keeps every read of a log unanswered until `release()`, and `holdKinds()` the read of
 *  the kinds until `releaseKinds()`. `kinds`: each kind's file in the config repo, by kind, each
 *  with `source`. Its root has `files`, and a context has none: only an iterate agent's context
 *  links to the root, and the page must not count on it. `row`: the name of the page's own row
 *  on a context, which the context answers (none: the page does not know it). `facets`: the
 *  processors each context hosts, by name, with each one's live state. What the page invokes on a
 *  context is kept in `invoked`, and each call of the call facet's methods, by method, in `steps`. */
function mind({
  serves = [],
  integrations,
  kinds,
  unreadable = false,
  source = "export default {};",
  logs = {},
  pages = {},
  row,
  facets = {},
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
  row?: string;
  facets?: Record<string, Record<string, unknown>>;
}) {
  const invoked: { path: string; call: unknown }[] = [];
  const steps: string[] = [];
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
    subscribe: async () => ({ name: row, [Symbol.dispose]() {} }),
    subscriptions: {
      list: async () => [
        ...(pages[path] || []).map(({ name, principal }) => ({
          name,
          target: `itx.builtins.rpcStubs.get('subscription:${name}')`,
          consumes: ["*", "presence/status"],
          configuredAtOffset: 1,
          heldBy: { principal, via: { appPage: "dash" } },
        })),
        ...Object.keys(facets[path] || {}).map((name) => ({
          name,
          consumes: [],
          configuredAtOffset: 1,
          hostedFacet: { name, className: "Facet" },
        })),
      ],
    },
    rpcStubs: { list: async () => (pages[path] || []).map(({ name }) => `subscription:${name}`) },
    invoke: async (call: unknown) => {
      invoked.push({ path, call });
      // a facet's method, as an expression: `["itx", "facets", ["get", name], [method, ...args]]`
      if (Array.isArray(call)) {
        const method = String(call[3][0]);
        steps.push(method);
        return method === "signal" ? { sdp: "v=0", tracks: [] } : {};
      }
      const facet = /facets\.get\('([^']+)'\)\.liveSnapshot/.exec(String(call))?.[1];
      const state = path === "/integrations" ? integrations : facet && facets[path]?.[facet];
      return { rev: 1, state: state || {} };
    },
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
    invoked,
    steps,
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

/** Another member, whose page is open on the agent. */
const memberB = { actor: "/members/b", email: "b@example.com" };

/** The call's live state, with each page in it (by its row) sending `tracks`. */
function callLive(inCall: Record<string, string[]>) {
  const who = (page: string) =>
    page === "a-page"
      ? { actor: "/members/a", name: "jo@example.com" }
      : { actor: memberB.actor, name: memberB.email };
  return {
    since: 1,
    inCall: Object.fromEntries(
      Object.entries(inCall).map(([page, tracks]) => [
        page,
        { who: who(page), tracks: Object.fromEntries(tracks.map((track) => [track, 1])) },
      ]),
    ),
    voiceAgent: null,
    setup: null,
    links: [],
  };
}

/** A browser with a microphone, a camera, a screen, WebRTC and Web Audio, as far as the call's
 *  engine uses them: jsdom has none. Each connection is connected at once, over UDP straight to
 *  the SFU; while `receives` is false, a receiving connection never connects. `refuse`: the name
 *  of the error each open of a device throws. `replaceFails`: each sender refuses a new track.
 *  `hold(step)` keeps the next of these steps unanswered until `release()`: "open" (a device),
 *  "display" (the screen's picker), "replaceTrack", "setParameters", "offer" (any connection's).
 *  `refuseNext(name)`: the next open of a device throws an error of that name. `connections` holds every
 *  connection made (`fire(type, event)` gives it an event; each transceiver keeps its `track`),
 *  `opened` every track the browser opened, `mic` the first microphone's, `displays` how often the
 *  screen's picker was asked for, `contexts` every AudioContext, `play` the media elements'
 *  `play`. Disposing takes the devices back. */
function browserMedia({
  receives = true,
  refuse,
  replaceFails = false,
}: { receives?: boolean; refuse?: string; replaceFails?: boolean } = {}) {
  type Track = ReturnType<typeof trackOf>;
  const connections: FakeConnection[] = [];
  const opened: Track[] = [];
  const contexts: { closed: boolean }[] = [];
  const state = { receives, sends: true, displays: 0, refuseNext: "" };
  const gates = new Map<string, Promise<void>>();
  /** The next `step` waits while it is held. */
  const gate = async (step: string) => {
    const held = gates.get(step);
    gates.delete(step);
    await held;
  };
  const trackOf = (kind: "audio" | "video") => {
    const track = {
      kind,
      enabled: true,
      readyState: "live",
      getSettings: () => ({ deviceId: "default", width: 1280 }),
      addEventListener() {},
      removeEventListener() {},
      stop() {
        track.readyState = "ended";
      },
    };
    return track;
  };
  const streamOf = (tracks: Track[]) => ({
    getAudioTracks: () => tracks.filter((one) => one.kind === "audio"),
    getVideoTracks: () => tracks.filter((one) => one.kind === "video"),
    getTracks: () => tracks,
  });
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: async (constraints: { audio?: object }) => {
        await gate("open");
        const once = state.refuseNext;
        state.refuseNext = "";
        if (once) throw Object.assign(new Error("refused"), { name: once });
        if (refuse) throw Object.assign(new Error("refused"), { name: refuse });
        const track = trackOf(constraints.audio ? "audio" : "video");
        opened.push(track);
        return streamOf([track]);
      },
      getDisplayMedia: async () => {
        state.displays += 1;
        await gate("display");
        const track = trackOf("video");
        opened.push(track);
        return streamOf([track]);
      },
      enumerateDevices: async () => [],
    },
  });
  class FakeConnection {
    closed = false;
    connectionState = "connected";
    iceGatheringState = "complete";
    localDescription: { type: string; sdp: string } | null = null;
    transceivers: { mid: string; stopped: boolean; track: Track }[] = [];
    channels: { sent: string[] }[] = [];
    listeners = new Map<string, ((event: object) => void)[]>();
    constructor() {
      connections.push(this);
    }
    addEventListener(type: string, listener: (event: object) => void) {
      this.listeners.set(type, [...(this.listeners.get(type) || []), listener]);
    }
    fire(type: string, event: object) {
      for (const listener of this.listeners.get(type) || []) listener(event);
    }
    addTransceiver = (track: Track) => {
      const transceiver = {
        mid: String(this.transceivers.length),
        stopped: false,
        track,
        sender: {
          replaceTrack: async () => {
            await gate("replaceTrack");
            if (replaceFails) throw new Error("the sender refused the track");
          },
          getParameters: () => ({ encodings: [] }),
          setParameters: async () => gate("setParameters"),
        },
        stop: () => void (transceiver.stopped = true),
      };
      this.transceivers.push(transceiver);
      return transceiver;
    };
    addTrack() {}
    createDataChannel = () => {
      const channel = { readyState: "open", sent: [] as string[], addEventListener() {} };
      this.channels.push(channel);
      return Object.assign(channel, { send: (message: string) => channel.sent.push(message) });
    };
    createOffer = async () => {
      await gate("offer");
      return { type: "offer", sdp: "v=0" };
    };
    createAnswer = async () => {
      if (!state.receives) this.connectionState = "new";
      return { type: "answer", sdp: "v=0" };
    };
    setLocalDescription = async (description: { type: string; sdp: string }) => {
      this.localDescription = description;
    };
    setRemoteDescription = async (description: { type: string }) => {
      if (description.type === "answer" && !state.sends) this.connectionState = "new";
    };
    getConfiguration = () => ({});
    setConfiguration() {}
    close() {
      this.closed = true;
    }
    getStats = async () =>
      new Map<string, object>([
        ["t", { type: "transport", selectedCandidatePairId: "p" }],
        ["p", { localCandidateId: "l", currentRoundTripTime: 0.02 }],
        ["l", { candidateType: "host", protocol: "udp" }],
      ]);
  }
  vi.stubGlobal("RTCPeerConnection", FakeConnection);
  vi.stubGlobal(
    "MediaStream",
    class {
      tracks: Track[];
      constructor(tracks: Track[] = []) {
        this.tracks = tracks;
      }
      getTracks = () => this.tracks;
      getAudioTracks = () => this.tracks.filter((one) => one.kind === "audio");
    },
  );
  vi.stubGlobal(
    "AudioContext",
    class {
      closed = false;
      constructor() {
        contexts.push(this);
      }
      resume = async () => {};
      createMediaStreamDestination = () => ({ stream: streamOf([trackOf("audio")]) });
      createMediaStreamSource = () => ({ connect() {}, disconnect() {} });
      close = async () => void (this.closed = true);
    },
  );
  const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(async () => {});
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  return {
    connections,
    opened,
    contexts,
    play,
    get mic() {
      return opened.find((one) => one.kind === "audio")!;
    },
    get displays() {
      return state.displays;
    },
    set receives(on: boolean) {
      state.receives = on;
    },
    /** false: a sending connection made from here never connects. */
    set sends(on: boolean) {
      state.sends = on;
    },
    /** The next open of a device throws an error of this name. */
    refuseNext(name: string) {
      state.refuseNext = name;
    },
    hold(step: "open" | "display" | "replaceTrack" | "setParameters" | "offer") {
      let release = () => {};
      gates.set(step, new Promise((resolve) => (release = resolve)));
      return { release: () => release() };
    },
    [Symbol.dispose]: () => void Reflect.deleteProperty(navigator, "mediaDevices"),
  };
}

/** The admission each call of `method` carried: a join's `{ admit }`, a refresh's `{ admission }`,
 *  or the last argument of a leave, a signal or a voice agent call. */
function admissionsOf(facet: ReturnType<typeof callFacet>, method: string) {
  return facet.calls
    .filter((one) => one.method === method)
    .map(({ args }) => {
      const last = args.at(-1) as { admit?: string; admission?: string } | string | undefined;
      return typeof last === "object" ? last.admit || last.admission : last;
    });
}

/** An agent's call facet, as a page's context holds it: each method called, in `steps`, answers at
 *  once, or throws what `fails` names for it (`failNext(method, error)`: its next call alone);
 *  `calls` holds each with its arguments after the page. `hold(method)` keeps that method's next call
 *  unanswered until `release()`; `hold("signal", step)` the next signalling step of that kind
 *  ("publish", "reset", …). Each signalling step is in `signals`, by its first key, and the
 *  kind of each publish in `published`. A subscribe's answer puts each track under the mid
 *  `m-<track>`. */
function callFacet(fails: Record<string, Error> = {}) {
  const steps: string[] = [];
  /** Each method called, with its arguments after the page. */
  const calls: { method: string; args: unknown[] }[] = [];
  const signals: string[] = [];
  const published: string[] = [];
  const held = new Map<string, Promise<void>>();
  const once = new Map<string, Error>();
  const failingSteps = new Map<string, Error>();
  return {
    steps,
    calls,
    /** The next call of `method` throws `error`. */
    failNext(method: string, error: Error) {
      once.set(method, error);
    },
    /** Every signalling step of this kind ("subscribe", …) throws `error` from now on. */
    failStep(step: string, error: Error) {
      failingSteps.set(step, error);
    },
    signals,
    published,
    hold(method: string, step?: string) {
      let release = () => {};
      held.set(step ? `${method}:${step}` : method, new Promise((resolve) => (release = resolve)));
      return { release: () => release() };
    },
    async invoke(call: unknown) {
      const method = Array.isArray(call) ? String(call[3][0]) : "";
      steps.push(method);
      if (Array.isArray(call)) calls.push({ method, args: call[3].slice(2) });
      const step = method === "signal" && Array.isArray(call) ? call[3][2] : {};
      if (method === "signal") signals.push(Object.keys(step)[0]!);
      if (step.publish) published.push(step.publish);
      for (const key of [method, `${method}:${Object.keys(step)[0]}`]) {
        const gate = held.get(key);
        held.delete(key);
        await gate;
      }
      const failing = once.get(method);
      once.delete(method);
      if (failing) throw failing;
      const stepFailing = method === "signal" && failingSteps.get(Object.keys(step)[0]!);
      if (stepFailing) throw stepFailing;
      if (fails[method]) throw fails[method];
      // each track subscribed to comes under the mid `m-<track>`
      const tracks = (step.subscribe || []).map((track: string) => ({ track, mid: `m-${track}` }));
      return method === "signal" ? { sdp: "v=0", tracks } : {};
    },
  };
}

/** The call's live state says this page is not in it, 6 s after its join: the page joins again.
 *  Answers the sync. */
function outOfTouch(call: ReturnType<typeof engineOn>) {
  const later = Date.now() + 6_000;
  vi.spyOn(Date, "now").mockReturnValue(later);
  return call.sync(viewOf(CallLive.parse(callLive({})), "a-page"));
}

/** The call's engine for the page `a-page`, on `facet`. */
function engineOn(facet: ReturnType<typeof callFacet>) {
  return createCall({
    facet: (method, ...args) => facet.invoke(["itx", "facets", ["get", "call"], [method, ...args]]),
    page: "a-page",
  });
}

/** One agent page's call, on a wide screen (`narrow`: a phone's), as `a-page`, with no call on the
 *  agent: `enable` is what a start turns the call on with. `update` gives the page what the context
 *  says next: the call's row, its live state, the page's own row (a new one after a reconnect). `place` is the header's place for the controls, and `seen` the
 *  buttons it had at each moment after the first. */
async function drawCall(
  facet: ReturnType<typeof callFacet>,
  enable: () => Promise<unknown>,
  { narrow = false } = {},
) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: narrow,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
  const host = document.body.appendChild(document.createElement("div"));
  const place = host.appendChild(document.createElement("div"));
  const seen: string[][] = [];
  const watcher = new MutationObserver(() => seen.push(buttonsOf(place)));
  watcher.observe(place, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  const root = createRoot(host.appendChild(document.createElement("div")));
  const update = ({
    facetOn = false,
    live,
    row = "a-page",
  }: {
    facetOn?: boolean;
    live?: object;
    row?: string;
  }) =>
    root.render(
      <AgentCall
        stub={facet}
        context={{
          subscription: row,
          processors: {
            rows: facetOn ? [{ hostedFacet: { name: "call" } }] : [],
            loaded: true,
          },
          liveState: live ? { call: { value: live } } : {},
        }}
        enable={enable}
        barIn={place}
      />,
    );
  await act(async () => update({}));
  return {
    place,
    seen,
    update,
    async [Symbol.asyncDispose]() {
      watcher.disconnect();
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

/** The text of every button in `element`, its title where it has one. */
function buttonsOf(element: Element) {
  return [...element.querySelectorAll("button")].map(
    (one) => one.title || one.textContent?.trim() || "",
  );
}

/** The button in `element` whose words or title say `text`; throws while there is none. */
function buttonOf(element: Element | null | undefined, text: string) {
  const found = [...(element?.querySelectorAll("button") || [])].find(
    (one) => one.title === text || one.textContent?.trim() === text,
  );
  if (!found) throw new Error(`no button "${text}"`);
  return found;
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
  history.replaceState(null, "", `/agents${path}`);
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
    call,
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
    /** The Agents page's `call`. */
    call?: DashPage["call"];
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
    { ...row("agents"), openers, presence, call },
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

/** The devices opened, and a mark for each sender of each connection: a join on arrival has none. */
function capturedNothing(media: ReturnType<typeof browserMedia>) {
  return {
    opened: media.opened.map((track) => track.kind),
    tracksSent: media.connections.flatMap((connection) =>
      connection.transceivers.map(() => "a track"),
    ),
  };
}

/** The call's refusal of a signalling step whose SFU session is gone (call/rules.ts). */
function sessionEnded() {
  return codedError(
    "CALL_SESSION_ENDED",
    "The SFU answered 410 to POST /sessions/…/tracks/new: Session appears to be disconnected.",
  );
}
