// @vitest-environment jsdom
// The transcript: a view of a log on the virtual log. What it says with nothing said, its lines as
// the log's rows, and older pages asked for through `older`. How it scrolls (it keeps a reader's
// place when older lines arrive, follows the end only at the end) is the virtual log's, proven in a
// browser, not in jsdom, which lays nothing out.
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import type { SpokenLine } from "./spoken-lines.ts";
import { TranscriptHistory } from "./transcript-history.tsx";

Object.assign(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: true,
  // jsdom lays nothing out, so it has no ResizeObserver; the virtual log's scroller asks for one
  ResizeObserver: class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
});

const LINES: SpokenLine[] = [
  { key: "1", who: "ben@example.com", at: 0, text: "hello" },
  { key: "2", who: "ana@example.com", at: 1000, text: "hi ben" },
];

test("with nothing said, the transcript's log says so", async () => {
  using history = await mount(
    <TranscriptHistory said={[]} older={exhausted()} me="ana@example.com" />,
  );
  expect(log(history.element)).toMatchObject({ textContent: "Nothing said yet." });
  expect(history.element.querySelector("button")).toBeNull();
});

test("the lines are the rows of a virtual log named Transcript, '(you)' after the viewer", async () => {
  using _page = laidOut();
  using history = await mount(
    <TranscriptHistory said={LINES} older={exhausted()} me="ana@example.com" />,
  );
  expect(history.element.querySelector('[data-slot="virtual-log"] [role="log"]')).toBe(
    log(history.element),
  );
  const rows = [...history.element.querySelectorAll("[data-index]")].map((row) => ({
    speaker: row.querySelector("b")?.textContent,
    text: row.lastElementChild?.lastChild?.textContent,
  }));
  expect(rows).toEqual([
    { speaker: "ben:", text: "hello" },
    { speaker: "ana (you):", text: "hi ben" },
  ]);
});

test("older pages are asked for through `older` while there are any, and not after", async () => {
  using _page = laidOut();
  const more = { loadOlder: vi.fn(), loading: false, exhausted: false };
  using _reading = await mount(
    <TranscriptHistory said={LINES} older={more} me="ana@example.com" />,
  );
  expect(more.loadOlder).toHaveBeenCalled();
  const none = exhausted();
  using _done = await mount(<TranscriptHistory said={LINES} older={none} me="ana@example.com" />);
  expect(none.loadOlder).not.toHaveBeenCalled();
});

/** Older pages that have run out, with a spy that must never be called. */
function exhausted() {
  return { loadOlder: vi.fn(), loading: false, exhausted: true };
}

/** The transcript's log: the element a screen reader reads as "Transcript". */
function log(element: HTMLElement) {
  return element.querySelector('[role="log"][aria-label="Transcript"]');
}

/** A page with height, which jsdom lacks, so the virtual log draws its rows; disposing takes it
 *  back. */
function laidOut() {
  const sizes = { clientHeight: 360, offsetHeight: 0 };
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

/** The transcript mounted in the document; disposing unmounts it. */
async function mount(node: ReactNode) {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  await act(async () => root.render(node));
  return {
    element: host.firstElementChild as HTMLElement, // TranscriptHistory renders one div
    [Symbol.dispose]: () => {
      act(() => root.unmount());
      host.remove();
    },
  };
}
