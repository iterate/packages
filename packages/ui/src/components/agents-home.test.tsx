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
