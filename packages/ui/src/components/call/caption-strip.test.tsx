// @vitest-environment jsdom
// The caption strip: what it says with nothing said, the newest six lines of many, the captions
// still being spoken, and the button that opens the transcript.
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { CaptionStrip } from "./caption-strip.tsx";
import type { SpokenLine } from "./spoken-lines.ts";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const NOBODY = { captions: [], pending: 0 };

test("with nothing said, the strip says where spoken lines appear", async () => {
  using strip = await mount(
    <CaptionStrip said={[]} live={NOBODY} me="ana@example.com" open={false} onOpen={() => {}} />,
  );
  expect(words(strip.element)).toEqual(["Spoken lines appear here."]);
  expect(strip.element.querySelector("button")).toMatchObject({ textContent: "Transcript" });
});

test("of many lines, the strip shows the newest six, oldest first, out of the screen reader's way", async () => {
  using strip = await mount(
    <CaptionStrip
      said={lines(10)}
      live={NOBODY}
      me="ana@example.com"
      open={false}
      onOpen={() => {}}
    />,
  );
  expect(words(strip.element)).toEqual(
    ["line 4", "line 5", "line 6", "line 7", "line 8", "line 9"].map((text) => `ana ${text}`),
  );
  expect(strip.element.querySelector('[aria-live="off"]')).not.toBeNull();
});

test("a caption still being spoken and the viewer's own transcribing come after, marked live", async () => {
  using strip = await mount(
    <CaptionStrip
      said={lines(1)}
      live={{ captions: [{ from: "c1", who: "ben@example.com", text: "so what" }], pending: 1 }}
      me="ana@example.com"
      open={false}
      onOpen={() => {}}
    />,
  );
  const spans = [...strip.element.querySelectorAll('[aria-live="off"] span')];
  expect(spans.map((span) => [span.textContent, span.hasAttribute("data-live")])).toEqual([
    ["ana line 0", false],
    ["ben so what", true],
    ["ana transcribing…", true],
  ]);
  expect(spans[2]?.className).toContain("italic");
});

test("the button counts the lines, says whether the transcript is open, and opens it", async () => {
  const onOpen = vi.fn();
  using closed = await mount(
    <CaptionStrip
      said={lines(3)}
      live={NOBODY}
      me="ana@example.com"
      open={false}
      onOpen={onOpen}
    />,
  );
  const button = closed.element.querySelector("button");
  expect(button).toMatchObject({ textContent: "Transcript (3)" });
  expect(button?.getAttribute("aria-expanded")).toBe("false");
  await act(async () => button?.click());
  expect(onOpen).toHaveBeenCalledOnce();
  using open = await mount(
    <CaptionStrip said={lines(3)} live={NOBODY} me="ana@example.com" open onOpen={onOpen} />,
  );
  expect(open.element.querySelector("button")?.getAttribute("aria-expanded")).toBe("true");
});

/** `count` lines said by one person, a second apart. */
function lines(count: number): SpokenLine[] {
  return Array.from({ length: count }, (_, i) => ({
    key: String(i),
    who: "ana@example.com",
    at: i * 1000,
    text: `line ${String(i)}`,
  }));
}

/** The strip's words, one string per speaker's span. */
function words(element: HTMLElement) {
  return [...element.querySelectorAll('[aria-live="off"] span')].map((span) => span.textContent);
}

/** The strip mounted in the document; disposing unmounts it. */
async function mount(node: ReactNode) {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  await act(async () => root.render(node));
  return {
    element: host.firstElementChild as HTMLElement, // CaptionStrip renders one div
    [Symbol.dispose]: () => {
      act(() => root.unmount());
      host.remove();
    },
  };
}
