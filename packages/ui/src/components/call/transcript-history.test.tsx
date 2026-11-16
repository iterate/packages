// @vitest-environment jsdom
// The transcript: what it says with nothing said, and the button that reads older pages.
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { TranscriptHistory } from "./transcript-history.tsx";
import { OLDER_EXHAUSTED } from "#/components/virtual-log/older-pages.ts";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

test("with nothing said, the transcript says so and offers no older lines when there are none", async () => {
  using history = await mount(
    <TranscriptHistory said={[]} older={OLDER_EXHAUSTED} me="ana@example.com" />,
  );
  expect(history.element).toMatchObject({ textContent: "Nothing said yet." });
  expect(history.element.querySelector("button")).toBeNull();
});

test("'Load older lines' reads the older pages", async () => {
  const older = { loadOlder: vi.fn(), loading: false, exhausted: false };
  using history = await mount(
    <TranscriptHistory
      said={[{ key: "1", who: "ben@example.com", at: 0, text: "hello" }]}
      older={older}
      me="ana@example.com"
    />,
  );
  const button = history.element.querySelector("button");
  expect(button).toMatchObject({ textContent: "Load older lines" });
  await act(async () => button?.click());
  expect(older.loadOlder).toHaveBeenCalledOnce();
  expect(history.element.querySelector("li")?.textContent).toMatch(/ ben: hello$/);
});

/** The transcript mounted in the document; disposing unmounts it. */
async function mount(node: ReactNode) {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  await act(async () => root.render(node));
  return {
    element: host.firstElementChild as HTMLElement, // TranscriptHistory renders one section
    [Symbol.dispose]: () => {
      act(() => root.unmount());
      host.remove();
    },
  };
}
