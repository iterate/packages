// @vitest-environment jsdom
// The feed's row for a run of spoken lines: its label, its faces while closed, and its lines open.
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import type { SpokenLine } from "./spoken-lines.ts";
import { TranscriptRollup } from "./transcript-rollup.tsx";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const START = new Date(2026, 10, 16, 14, 2).getTime();

test("one line is '1 line said' and its one time", async () => {
  using row = await mount(
    <TranscriptRollup
      lines={[line(0)]}
      me="ana@example.com"
      expanded={false}
      onToggle={() => {}}
    />,
  );
  expect(spokenLabel(row.element)).toBe(`1 line said · ${clock(START)}`);
});

test("many lines are 'N lines said' from the first time to the last", async () => {
  const lines = [0, 1, 2, 3].map((i) => line(i));
  using row = await mount(
    <TranscriptRollup lines={lines} me="ana@example.com" expanded={false} onToggle={() => {}} />,
  );
  expect(spokenLabel(row.element)).toBe(
    `4 lines said · ${clock(START)} to ${clock(START + 3 * 60_000)}`,
  );
});

test("closed, the row shows the faces of up to three speakers and no line", async () => {
  const lines = ["a", "b", "a", "c", "d"].map((who, i) => line(i, `${who}@example.com`));
  const onToggle = vi.fn();
  using row = await mount(
    <TranscriptRollup lines={lines} me="a@example.com" expanded={false} onToggle={onToggle} />,
  );
  const button = row.element.querySelector("button");
  expect(button?.getAttribute("aria-expanded")).toBe("false");
  expect(button?.querySelectorAll('[data-slot="avatar"]')).toHaveLength(3);
  expect(row.element.querySelector("li")).toBeNull();
  await act(async () => button?.click());
  expect(onToggle).toHaveBeenCalledOnce();
});

test("open, the row lists each line with its speaker, '(you)' after the viewer", async () => {
  const lines = [line(0, "ana@example.com"), line(1, "ben@example.com")];
  using row = await mount(
    <TranscriptRollup lines={lines} me="ana@example.com" expanded onToggle={() => {}} />,
  );
  expect(row.element.querySelector("button")?.getAttribute("aria-expanded")).toBe("true");
  const items = [...row.element.querySelectorAll("li")].map((item) => ({
    time: item.querySelector("time")?.textContent,
    speaker: item.querySelector("b")?.textContent,
    text: item.lastChild?.textContent,
  }));
  expect(items).toEqual([
    { time: new Date(START).toLocaleTimeString(), speaker: "ana (you):", text: "line 0" },
    { time: new Date(START + 60_000).toLocaleTimeString(), speaker: "ben:", text: "line 1" },
  ]);
});

test("beyond 200 lines the open row shows the newest 200 and says so", async () => {
  const lines = Array.from({ length: 250 }, (_, i) => line(i, "ana@example.com", START));
  using row = await mount(
    <TranscriptRollup lines={lines} me="ben@example.com" expanded onToggle={() => {}} />,
  );
  const items = row.element.querySelectorAll("li");
  expect(items).toHaveLength(200);
  expect(items[0]?.textContent).toMatch(/line 50$/);
  expect(row.element.querySelector("p")).toMatchObject({
    textContent: "The newest 200. The transcript has them all.",
  });
});

/** The minute of `at`, as the row writes it. */
function clock(at: number) {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Line `i`, said by `who` at `at` (by default a minute after the line before). */
function line(i: number, who = "ana@example.com", at = START + i * 60_000): SpokenLine {
  return { key: String(i), who, at, text: `line ${String(i)}` };
}

/** The button's text as a screen reader reads it: without the faces, which are aria-hidden. */
function spokenLabel(element: HTMLElement) {
  return [...(element.querySelector("button")?.childNodes ?? [])]
    .filter((node) => !(node instanceof Element && node.hasAttribute("aria-hidden")))
    .map((node) => node.textContent)
    .join("");
}

/** The row mounted in the document; disposing unmounts it. */
async function mount(node: ReactNode) {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  await act(async () => root.render(node));
  return {
    element: host.firstElementChild as HTMLElement, // TranscriptRollup renders one div
    [Symbol.dispose]: () => {
      act(() => root.unmount());
      host.remove();
    },
  };
}
