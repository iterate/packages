// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test } from "vitest";
import { AllAgents } from "./agents-home.tsx";
import type { AgentRow } from "#/lib/agent-summary.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

test("a row of every agent is as tall as the browser's text makes it, and one line taller with a title: a larger default font moves each row down, so no row draws over the next or over the heading", async () => {
  // the browser's default font size, as its settings make it: twice the usual 16 px
  document.documentElement.style.fontSize = "32px";
  using _ = laidOut();
  const at = new Date(0).toISOString();
  const agents = [
    ["/agents/a", "A"],
    ["/agents/b", null],
    ["/agents/c", "C"],
  ].map(([path, title]): AgentRow => ({
    path: path!,
    createdAt: at,
    parent: null,
    kind: "iterate",
    host: null,
    status: null,
    activity: null,
    description: null,
    title: title || null,
    lastActivityAt: null,
  }));
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () =>
    root.render(<AllAgents agents={agents} nowMs={0} agentHref={(path) => path || "/"} />),
  );
  const rows = [...document.querySelectorAll<HTMLElement>('ul[aria-label="Every agent"] li')];
  // a row with a title is 4.25rem, one without 3.25rem: 136 px and 104 px at 32 px
  expect(rows.map((row) => [row.style.transform, row.style.height])).toEqual([
    ["translateY(0px)", "4.25rem"],
    ["translateY(136px)", "3.25rem"],
    ["translateY(240px)", "4.25rem"],
  ]);
  expect(document.querySelector<HTMLElement>('ul[aria-label="Every agent"]')?.style.height).toBe(
    "376px",
  );
  act(() => root.unmount());
  document.body.replaceChildren();
  document.documentElement.style.fontSize = "";
});

test("a row that gains a title moves the rows after it down at once", async () => {
  using _ = laidOut();
  const at = new Date(0).toISOString();
  const agent = (path: string, title: string | null): AgentRow => ({
    path,
    createdAt: at,
    parent: null,
    kind: "iterate",
    host: null,
    status: null,
    activity: null,
    description: null,
    title,
    lastActivityAt: null,
  });
  const starts = () =>
    [...document.querySelectorAll<HTMLElement>('ul[aria-label="Every agent"] li')].map(
      (row) => row.style.transform,
    );
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  const draw = (agents: AgentRow[]) =>
    act(async () =>
      root.render(<AllAgents agents={agents} nowMs={0} agentHref={(path) => path || "/"} />),
    );
  await draw([agent("/agents/a", null), agent("/agents/b", null)]);
  expect(starts()).toEqual(["translateY(0px)", "translateY(52px)"]);
  // the catalog's live rows change: /agents/a names itself
  await draw([agent("/agents/a", "A"), agent("/agents/b", null)]);
  expect(starts()).toEqual(["translateY(0px)", "translateY(68px)"]);
  act(() => root.unmount());
  document.body.replaceChildren();
});

test("a subagent has a row only while it is at work: one that stopped is in its agent's count and no more", async () => {
  using _ = laidOut();
  const nowMs = Date.parse("2026-11-16T16:00:00Z");
  const agent = (path: string, status: AgentRow["status"], lastActivityAt: string): AgentRow => ({
    path,
    createdAt: lastActivityAt,
    parent: null,
    kind: "claude",
    host: null,
    status,
    activity: null,
    description: null,
    title: path,
    lastActivityAt,
  });
  const agents = [
    agent("/agents/a", "idle", "2026-11-16T15:59:00Z"),
    agent("/agents/a/at-work", "working", "2026-11-16T15:59:30Z"),
    agent("/agents/a/stopped", "idle", "2026-11-16T15:00:00Z"),
    // it still says "working", two days after its last activity
    agent("/agents/a/stale", "working", "2026-11-14T15:00:00Z"),
  ];
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () =>
    root.render(<AllAgents agents={agents} nowMs={nowMs} agentHref={(path) => path || "/"} />),
  );
  const rows = [...document.querySelectorAll<HTMLElement>("[data-agent-path]")];
  expect(rows.map((row) => row.dataset.agentPath)).toEqual(["/agents/a", "/agents/a/at-work"]);
  expect(rows[0]!.textContent).toContain("and 3 subagents");
  act(() => root.unmount());
  document.body.replaceChildren();
});

test.for([
  {
    name: "with a title, at work: the title, the path, the summary",
    title: "Mail desk",
    status: "working" as const,
    description: "Answers the mail",
    lines: ["Mail desk", "/agents/mail", "Drawing the monkey"],
  },
  {
    name: "with a title, at rest: the title, the path, the description and not the old summary",
    title: "Mail desk",
    status: "idle" as const,
    description: "Answers the mail",
    lines: ["Mail desk", "/agents/mail", "Answers the mail"],
  },
  {
    name: "no title, at work: the path, the summary",
    title: null,
    status: "working" as const,
    description: "Answers the mail",
    lines: ["/agents/mail", "Drawing the monkey"],
  },
  {
    name: "no title, at rest: the path, the description",
    title: null,
    status: "idle" as const,
    description: "Answers the mail",
    lines: ["/agents/mail", "Answers the mail"],
  },
  {
    name: "no title, at rest, no description: the path alone",
    title: null,
    status: "idle" as const,
    description: null,
    lines: ["/agents/mail"],
  },
])("a row of every agent, $name", async ({ title, status, description, lines }) => {
  using _ = laidOut();
  const nowMs = Date.parse("2026-11-16T16:00:00Z");
  const row: AgentRow = {
    path: "/agents/mail",
    createdAt: "2026-11-16T14:00:00Z",
    parent: null,
    kind: "iterate",
    host: null,
    status,
    activity: "Drawing the monkey",
    description,
    title,
    // at rest, its last task ended an hour ago: that task's summary is stale
    lastActivityAt: status === "working" ? "2026-11-16T15:59:30Z" : "2026-11-16T15:00:00Z",
  };
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () =>
    root.render(<AllAgents agents={[row]} nowMs={nowMs} agentHref={(path) => path || "/"} />),
  );
  expect(linesOf(document.querySelector('[data-agent-path="/agents/mail"]')!)).toEqual(lines);
  act(() => root.unmount());
  document.body.replaceChildren();
});

test("the subagents line starts the last line, before the summary", async () => {
  using _ = laidOut();
  const at = "2026-11-16T15:00:00Z";
  const agent = (path: string): AgentRow => ({
    path,
    createdAt: at,
    parent: null,
    kind: "iterate",
    host: null,
    status: "idle",
    activity: null,
    description: "Answers the mail",
    title: null,
    lastActivityAt: at,
  });
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () =>
    root.render(
      <AllAgents
        agents={[agent("/agents/mail"), agent("/agents/mail/sub")]}
        nowMs={Date.parse("2026-11-16T16:00:00Z")}
        agentHref={(path) => path || "/"}
      />,
    ),
  );
  expect(linesOf(document.querySelector('[data-agent-path="/agents/mail"]')!)).toEqual([
    "/agents/mail",
    "and 1 subagent · Answers the mail",
  ]);
  act(() => root.unmount());
  document.body.replaceChildren();
});

/** The text of each span of a row that holds no element: its lines, the time aside. */
function linesOf(row: Element): string[] {
  return [...row.querySelectorAll("span")]
    .filter((span) => !span.firstElementChild && span.textContent)
    .map((span) => span.textContent!);
}

/** A page with height, which jsdom lacks, so the virtual list draws its rows; disposing takes it
 *  back. */
function laidOut() {
  const sizes = { clientHeight: 600, clientWidth: 800 };
  const own = Object.keys(sizes).map(
    (name) => [name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name)] as const,
  );
  for (const [name, value] of Object.entries(sizes))
    Object.defineProperty(HTMLElement.prototype, name, { configurable: true, get: () => value });
  return {
    [Symbol.dispose]: () => {
      for (const [name, descriptor] of own)
        if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor);
        else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
    },
  };
}
