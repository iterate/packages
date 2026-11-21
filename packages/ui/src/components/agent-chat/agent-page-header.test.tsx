// @vitest-environment jsdom
// The agent page's header on a page with no AppShell (Meet): a header row of its own, with the way
// back, the title and the path at the left, then who is here (the mind's face first), Start call,
// Share and Chat | Events. Each place is drawn from the first paint.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { AgentPageHeader, heldRowsOf } from "./agent-page-header.tsx";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

test("with no AppShell the header is a row of its own, in the Dash's order, and nothing is an empty place", async () => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  await act(() =>
    root.render(
      <AgentPageHeader
        path="/agents/meet/standup"
        title="Standup"
        before={<a href="/">All meetings</a>}
        mind={{ name: "Acme", logo: <img src="/acme.svg" alt="" /> }}
        presence
        call
        share
      />,
    ),
  );
  const header = host.querySelector("header")!;
  expect(header.querySelector("[data-page-header]")).not.toBe(null);
  expect(header.textContent).toContain("All meetings");
  expect(header.textContent).toContain("Standup");
  expect(
    [...header.querySelectorAll("[data-slot^=agent-header-]")].map((place) => [
      place.getAttribute("data-slot"),
      place.className,
      place.children.length > 0,
    ]),
  ).toEqual([
    ["agent-header-aside", "contents", true],
    ["agent-header-call", "contents", true],
    ["agent-header-share", "contents", true],
  ]);
  expect(header.querySelector("[data-mind-face]")?.getAttribute("aria-label")).toBe("Acme");
  // out of the call: Start call, which waits for the call's part
  expect(
    header.querySelector("[data-slot=agent-header-call] button")?.getAttribute("aria-label"),
  ).toBe("Start call");
  // the tabs are there, and cannot be pressed until the page passes them
  expect(header.querySelector("[inert] [role=tablist]")).not.toBe(null);
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

test("the Events tab's count leaves out a page's presence status", () => {
  expect(
    heldRowsOf([
      { type: "events.iterate.com/agent/message-received" },
      { type: "presence/status" },
    ]),
  ).toBe(1);
});
