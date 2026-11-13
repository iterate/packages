// @vitest-environment jsdom
// A press of the Change my mind button: what it copies, what it says, and what it shows when the
// browser refuses to copy.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { ChangeMyMindButton } from "./change-my-mind-button.tsx";
import { changeMyMindInstructions } from "#/lib/change-my-mind.ts";

test("a press copies the post's instructions, says Copied, and shows the card", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const writeText = vi.fn(() => Promise.resolve());
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  const source = "https://blog.example.com/posts/voice-calls";
  const { host, button, unmount } = await press(<ChangeMyMindButton source={source} />);

  expect(writeText).toHaveBeenCalledWith(changeMyMindInstructions({ source }));
  expect(button.querySelector(".invisible")?.textContent).toBe("Change my mind");
  expect(host.querySelector("[role=status]")?.textContent).toBe(
    "Copied to clipboard. Paste it to your iterate mind.",
  );
  const card = document.querySelector("[data-slot=popover-content]");
  expect(card?.textContent).toContain("No mind yet? Get your own");
  expect(card?.querySelector("a")?.getAttribute("href")).toBe("https://cloud.iterate.com");

  await act(() => vi.advanceTimersByTime(2000));
  expect(button.querySelector(".invisible")?.textContent).toBe("Copied");
  await act(() => vi.advanceTimersByTime(3000));
  expect(host.querySelector("[role=status]")?.textContent).toBe("");
  vi.useRealTimers();
  await unmount();
});

test("when the browser refuses to copy, the card holds the text to select", async () => {
  vi.stubGlobal("navigator", { clipboard: { writeText: () => Promise.reject(new Error("no")) } });
  document.execCommand = () => false;
  const { unmount } = await press(<ChangeMyMindButton instructions="Make me a cup of tea." />);
  const box = document.querySelector<HTMLTextAreaElement>("[data-slot=popover-content] textarea");
  expect(box?.value).toBe("Make me a cup of tea.");
  expect(box?.readOnly).toBe(true);
  await unmount();
});

test("the outline variant is the kit's outline Button, and a press shows the same card", async () => {
  vi.stubGlobal("navigator", { clipboard: { writeText: () => Promise.resolve() } });
  const { button, unmount } = await press(<ChangeMyMindButton variant="outline" size="sm" />);
  expect(button.className).toContain("border-border bg-background hover:bg-muted");
  expect(button.className).not.toContain("bg-primary");
  expect(button.firstElementChild?.className).toContain("text-foreground");
  expect(document.querySelector("[data-slot=popover-content]")?.textContent).toContain(
    "Copied to clipboard. Paste it to your iterate mind.",
  );
  await unmount();
});

// jsdom runs no layout; Base UI's popover asks for these
globalThis.ResizeObserver ||= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

async function press(element: React.ReactElement) {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  await act(() => root.render(element));
  const button = host.querySelector("button")!;
  await act(async () => button.click());
  return { host, button, unmount: () => act(() => root.unmount()) };
}
