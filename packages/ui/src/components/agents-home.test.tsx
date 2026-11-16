// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test } from "vitest";
import { AllAgents } from "./agents-home.tsx";
import type { AgentRow } from "#/lib/agent-summary.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

test("a row of every agent is as tall as the browser's text makes it: a larger default font moves each row down, so no row draws over the next or over the heading", async () => {
  // the browser's default font size, as its settings make it: twice the usual 16 px
  document.documentElement.style.fontSize = "32px";
  using _ = laidOut();
  const at = new Date(0).toISOString();
  const agents = ["/agents/a", "/agents/b", "/agents/c"].map((path): AgentRow => ({
    path,
    createdAt: at,
    parent: null,
    kind: "iterate",
    host: null,
    status: null,
    activity: null,
    description: null,
    title: path,
    lastActivityAt: null,
  }));
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () =>
    root.render(<AllAgents agents={agents} nowMs={0} agentHref={(path) => path || "/"} />),
  );
  const rows = [...document.querySelectorAll<HTMLElement>('ul[aria-label="Every agent"] li')];
  expect(rows.map((row) => row.style.transform)).toEqual([
    "translateY(0px)",
    "translateY(104px)",
    "translateY(208px)",
  ]);
  expect(document.querySelector<HTMLElement>('ul[aria-label="Every agent"]')?.style.height).toBe(
    "312px",
  );
  act(() => root.unmount());
  document.body.replaceChildren();
  document.documentElement.style.fontSize = "";
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

test("under a title is what the agent does now while it is at work, and what it is for when it is not", async () => {
  using _ = laidOut();
  const nowMs = Date.parse("2026-11-16T16:00:00Z");
  const agent = (path: string, status: AgentRow["status"], activity: string | null): AgentRow => ({
    path,
    createdAt: "2026-11-16T15:59:00Z",
    parent: null,
    kind: "iterate",
    host: null,
    status,
    activity,
    description: `The purpose of ${path}`,
    title: path,
    lastActivityAt: "2026-11-16T15:59:30Z",
  });
  const agents = [
    agent("/agents/at-work", "working", "Drawing the monkey"),
    // its last task ended an hour of silence ago for a list: the label of that task is not shown
    {
      ...agent("/agents/done", "idle", "Drawing the monkey"),
      lastActivityAt: "2026-11-16T14:00:00Z",
    },
  ];
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () =>
    root.render(<AllAgents agents={agents} nowMs={nowMs} agentHref={(path) => path || "/"} />),
  );
  const text = (path: string) =>
    document.querySelector<HTMLElement>(`[data-agent-path="${path}"]`)?.textContent;
  expect(text("/agents/at-work")).toContain("Drawing the monkey");
  expect(text("/agents/at-work")).not.toContain("The purpose of");
  expect(text("/agents/done")).toContain("The purpose of /agents/done");
  expect(text("/agents/done")).not.toContain("Drawing the monkey");
  act(() => root.unmount());
  document.body.replaceChildren();
});

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
